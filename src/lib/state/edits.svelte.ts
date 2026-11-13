// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The edit dispatcher (phase-2.md 6.8, 7.3, 11.2; ADR-0008): every visual edit goes through here
 * and becomes one minimal text patch through the edit API, one undo step, one toast, and a pending
 * mark until the engine has scheduled it. Views never change the text or the schedule themselves.
 *
 * ## Contract (for T15 selection, T16 Gantt interactions, T17 inspector)
 *
 * `app.edits` is the open plan's `EditDispatcher` (null while a plan loads; one per plan). Types
 * are in edits-types.ts and re-exported here.
 *
 * - **Dispatch a Gantt action** (a drop, a key, a stepper): `dispatchAction(action, source, opts?,
 *   preview?)`. `source` is what the Gantt draws, the result and its driving analysis as one pair
 *   (`GanttAnalysis.shown`). The dispatcher adds the index (`runner.ensureIndex()`), the working
 *   time, the zones and the move preference, and plans with `planAction` (gantt/intents.ts).
 * - **Dispatch an edit intent** (the inspector's fields): `dispatch(intent, { label }, preview?)`;
 *   pass `constraint: true` when it adds a `start` or `end` the task did not have.
 * - `preview` is the dragged item's geometry (`PendingMark`). It shows at once in `pending.byTask`
 *   (state `preview`), becomes `pending` once applied, and is dropped when the result that
 *   includes the edit schedules, so the bar animates to the engine's dates. When that result does
 *   not schedule, the bar goes back to its last good place marked `not-scheduled` (11.2) until the
 *   plan schedules again or its toast closes.
 * - **What comes back** (a promise of `DispatchOutcome`):
 *   - `applied`: in the text as one undo step (`entry`, the history entry id), with a toast;
 *     `settled` resolves with the `Settlement`: `scheduled`; `not-scheduled` with the first new
 *     error and its place; `failed`; `undone` when it was undone before a result; `dropped` when
 *     the plan closed;
 *   - `refused`: the Gantt's or the edit API's reason, one sentence and the place in the text; a
 *     toast with "Show in text" is up;
 *   - `noop`: nothing to change (a short toast said so);
 *   - `ask-move-preference`: ask once (`ganttActionStrings.movePreference`, pre-selecting
 *     `suggested`), call `setMovePreference(kind)`, then dispatch the same action again;
 *   - `confirm-shared`: the change edits text read in several places (`affects` lists the ids);
 *     ask, then dispatch again with `confirmShared: true`;
 *   - `cancelled`: a newer call with the same `coalesceKey` replaced it, or the plan closed.
 * - **Coalescing** (keyboard nudges, stepper presses; 6.8 step 6, 19.7): calls with the same
 *   `coalesceKey` within `COALESCE_MS` keep only the newest, whose preview shows. Send the
 *   cumulative action (`move` by 3 days after three presses), not the step. It is dispatched after
 *   300 ms of quiet, or at once on `flush(key)`: call it on blur and on Enter.
 * - **Renames**: while a `moveTask` is pending, `pending.renames` maps the old id to the new one.
 * - **Toasts** (`toasts`, newest last; toasts.svelte.ts): `undoToast(id)` does what Mod-Z does,
 *   only while that toast's entry is the top of the history (`canUndo`); `showToast(id)` reveals
 *   its place in the text; `dismissToast(id)` closes it.
 *
 * ## Order of work for one call
 *
 * 1. A fresh index (`ensureIndex`; if it throws, `unprepared`), the plan and `applyIntent` on the
 *    current snapshot (edits-plan.ts). `stale` or `needs-schedule` plans again once.
 * 2. The Android gate: if a file the edit changes is the one the editor shows and CodeMirror
 *    holds an Android key there, wait (16 ms steps, about 500 ms at most; tjp/cm/android-key.ts).
 * 3. If the workspace moved meanwhile (typing), plan again from 1: a stale patch is never applied
 *    (and `Workspace.apply` checks every base version too). After three plans: `stale`.
 * 4. `applyEdit`, naming the history entry with the label; the toast; the pending record, keyed
 *    by the workspace version the edit produced; the one-time constraint warning (gantt/prefs.ts).
 * 5. Settle on the runner's first state that includes that version (edits-settle.ts, the rule in
 *    workspace/run-types.ts), or `undone` when the history undoes the entry first.
 *
 * Calls run one at a time, in the order they were made.
 */
import type { GanttAction, MoveKind } from '../gantt/intents';
import { refusalMessage } from '../gantt/intents';
import {
	clearMovePreference,
	readMovePreference,
	takeConstraintWarning,
	writeMovePreference,
} from '../gantt/prefs';
import { toastStrings } from '../strings';
import { afterAndroidKey, type KeyTimers } from '../tjp/cm/android-key';
import { applyEdit } from '../tjp/edit/apply';
import type { EditIntent, SourceRange } from '../tjp/edit/types';
import type { TaskId } from '../tjp/index';
import { historyLabel } from '../workspace/history';
import type { RunnerState } from '../workspace/run-types';
import { movedId, prepare, refused, type Prepared } from './edits-plan';
import { errorIdsOf, settleOf, type Located, type Settlement } from './edits-settle';
import type {
	ActionDispatchOptions,
	ActionSource,
	DispatchOptions,
	DispatchOutcome,
	EditDispatcherDeps,
	Job,
	PendingEdits,
	PendingMark,
} from './edits-types';
import { PendingBars } from './pending-bars';
import { Toasts, type Toast } from './toasts.svelte';

export type * from './edits-types';
export type { Located, Settlement } from './edits-settle';
export type { Toast, ToastStatus } from './toasts.svelte';
export { movedId } from './edits-plan';

/** Quiet time before coalesced calls are dispatched. */
export const COALESCE_MS = 300;
/** Plans per call before it is refused as `stale`. */
const MAX_PLANS = 3;
const CANCELLED: DispatchOutcome = { status: 'cancelled' };
const NO_PENDING: PendingEdits = { byTask: new Map(), renames: new Map(), count: 0 };

interface Applied {
	readonly seq: number;
	readonly entry: string;
	readonly version: number;
	/** The error ids of the good run before the edit (edits-settle.ts). */
	readonly baseline: ReadonlySet<string>;
	readonly toast: number;
	readonly task: TaskId | null;
	readonly rename: readonly [TaskId, TaskId] | null;
	readonly resolve: (s: Settlement) => void;
}

interface Held {
	readonly job: Job;
	readonly resolve: (o: DispatchOutcome) => void;
	readonly timer: unknown;
}

const globalTimers: KeyTimers = {
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
};

export class EditDispatcher {
	#pending = $state.raw<PendingEdits>(NO_PENDING);
	readonly #toasts: Toasts;
	readonly #d: EditDispatcherDeps;
	readonly #timers: KeyTimers;
	readonly #bars = new PendingBars();
	readonly #applied: Applied[] = [];
	readonly #held = new Map<string, Held>();
	readonly #off: Array<() => void>;
	#state: RunnerState | null = null;
	#chain: Promise<unknown> = Promise.resolve();
	#seq = 0;
	#disposed = false;

	constructor(deps: EditDispatcherDeps) {
		this.#d = deps;
		this.#timers = deps.timers ?? globalTimers;
		this.#toasts = new Toasts(this.#timers, (t) => this.#closed(t));
		this.#off = [
			deps.runner.subscribe((s) => this.#onRunner(s)),
			deps.history.subscribe(() => this.#onHistory()),
		];
	}

	get pending(): PendingEdits {
		return this.#pending;
	}

	get toasts(): readonly Toast[] {
		return this.#toasts.list;
	}

	get movePreference(): MoveKind | null {
		return readMovePreference(this.#d.storage ?? null)?.kind ?? null;
	}

	/** Stores the answer to the move question (null forgets it: the next move asks again). */
	setMovePreference(kind: MoveKind | null): void {
		const s = this.#d.storage ?? null;
		if (kind === null) clearMovePreference(s);
		else writeMovePreference(s, { kind });
	}

	dispatch(
		intent: EditIntent,
		o: DispatchOptions,
		preview?: PendingMark,
	): Promise<DispatchOutcome> {
		return this.#enqueue({ seq: ++this.#seq, preview, kind: 'intent', intent, o });
	}

	dispatchAction(
		action: GanttAction,
		source: ActionSource,
		o: ActionDispatchOptions = {},
		preview?: PendingMark,
	): Promise<DispatchOutcome> {
		return this.#enqueue({ seq: ++this.#seq, preview, kind: 'action', action, source, o });
	}

	/** Dispatches the coalesced call for `key` now (every key when omitted): on blur and Enter. */
	flush(key?: string): void {
		for (const [k, h] of [...this.#held]) {
			if (key !== undefined && k !== key) continue;
			this.#held.delete(k);
			this.#timers.clearTimeout(h.timer);
			void this.#serial(h.job).then(h.resolve);
		}
	}

	/** Undoes the toast's edit as Mod-Z does, while it is the top entry (after the Android gate). */
	undoToast(id: number): void {
		const entry = this.#toasts.get(id)?.entry ?? null;
		const top = this.#d.history.top();
		if (entry === null || top?.id !== entry) return;
		const paths = Object.keys(top.applied.edit.changes);
		afterAndroidKey(
			() => this.#d.keyHeld?.(paths) ?? false,
			() => {
				if (!this.#disposed && this.#d.history.top()?.id === entry) this.#d.undo();
			},
			this.#timers,
		);
	}

	/** Reveals the toast's place in the text as it is now. */
	showToast(id: number): void {
		const at = this.#toasts.get(id)?.show ?? null;
		const r = at ? this.#now(at) : null;
		if (r) this.#d.reveal?.(r);
	}

	dismissToast(id: number): void {
		this.#toasts.remove(id);
	}

	/** The plan closes: waiting calls are cancelled, applied edits settle as `dropped`. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const off of this.#off) off();
		for (const h of this.#held.values()) {
			this.#timers.clearTimeout(h.timer);
			h.resolve(CANCELLED);
		}
		this.#held.clear();
		for (const a of [...this.#applied]) this.#settle(a, { status: 'dropped' });
		this.#toasts.clear();
		this.#bars.clear();
		this.#publish();
	}

	#enqueue(job: Job): Promise<DispatchOutcome> {
		if (this.#disposed) return Promise.resolve(CANCELLED);
		if (job.preview) {
			this.#bars.set(job.preview, 'preview', job.seq);
			this.#publish();
		}
		const key = job.o.coalesceKey;
		if (key === undefined) return this.#serial(job);
		const prev = this.#held.get(key);
		if (prev) {
			this.#timers.clearTimeout(prev.timer);
			this.#dropBar(prev.job);
			prev.resolve(CANCELLED);
		}
		return new Promise((resolve) => {
			const timer = this.#timers.setTimeout(() => this.flush(key), COALESCE_MS);
			this.#held.set(key, { job, resolve, timer });
		});
	}

	#serial(job: Job): Promise<DispatchOutcome> {
		const run = this.#chain.then(() => this.#run(job));
		this.#chain = run.catch(() => undefined);
		return run;
	}

	async #run(job: Job): Promise<DispatchOutcome> {
		let replanned = false;
		for (let plans = 0; plans < MAX_PLANS; plans++) {
			if (this.#disposed) return this.#done(job, CANCELLED);
			const p = prepare(this.#d, job);
			if (p.status === 'replan') {
				if (replanned) break;
				replanned = true;
				continue;
			}
			if (p.status === 'done') return this.#done(job, p.outcome, p.at);
			const paths = Object.keys(p.edit.changes);
			const held = this.#d.keyHeld;
			if (held?.(paths)) {
				await new Promise<void>((go) => afterAndroidKey(() => held(paths), go, this.#timers));
				if (this.#disposed) return this.#done(job, CANCELLED);
			}
			// Typing (the held key, say) may have moved the text: plan again, never apply stale.
			if (this.#d.workspace.snapshot().version !== p.version) continue;
			const applied = applyEdit(this.#d.workspace, p.edit, {
				annotations: [historyLabel.of(p.label.text)],
			});
			if (applied === 'stale') continue;
			return this.#record(job, p);
		}
		return this.#done(job, refused('stale', [], refusalMessage('stale')));
	}

	/** A call that did not apply: its preview goes, and a toast says why. */
	#done(job: Job, outcome: DispatchOutcome, at?: Located): DispatchOutcome {
		this.#dropBar(job);
		if (outcome.status === 'refused') this.#toasts.refused(outcome.message, at ?? null);
		else if (outcome.status === 'noop') this.#toasts.noop(outcome.message);
		return outcome;
	}

	#record(job: Job, p: Extract<Prepared, { status: 'ready' }>): DispatchOutcome {
		const version = this.#d.workspace.snapshot().version;
		const intent = p.edit.intent;
		const end = intent.type === 'setAttr' && intent.attr === 'end';
		const warning =
			p.constraint && takeConstraintWarning(this.#d.storage ?? null)
				? toastStrings.constraint[end ? 'end' : 'start']
				: null;
		const toast = this.#toasts.edit(p.label, p.edit.id, warning);
		if (job.preview) this.#bars.set(job.preview, 'pending', job.seq, toast);
		let resolve: (s: Settlement) => void = () => undefined;
		const settled = new Promise<Settlement>((r) => (resolve = r));
		this.#applied.push({
			seq: job.seq,
			entry: p.edit.id,
			version,
			baseline: errorIdsOf(this.#state?.lastGood?.result),
			toast,
			task: job.preview?.task ?? null,
			rename:
				intent.type === 'moveTask' ? [intent.task, movedId(intent.task, intent.parent)] : null,
			resolve,
		});
		this.#onHistory();
		this.#publish();
		return { status: 'applied', edit: p.edit, entry: p.edit.id, version, toast, settled };
	}

	#onRunner(s: RunnerState): void {
		this.#state = s;
		for (const a of [...this.#applied]) {
			const st = settleOf(s, a.version, a.baseline);
			if (st) this.#settle(a, st);
		}
		// The plan schedules again: bars marked "not scheduled" go back to normal.
		if (s.latest?.result.ok && !s.outdated && this.#bars.clearNotScheduled()) this.#publish();
	}

	#onHistory(): void {
		const undone = this.#d.history.redoTop()?.id ?? null;
		for (const a of [...this.#applied]) {
			if (a.entry === undone) this.#settle(a, { status: 'undone' });
		}
		if (undone !== null) this.#toasts.removeEntry(undone);
		this.#toasts.setTop(this.#d.history.top()?.id ?? null);
	}

	#settle(a: Applied, st: Settlement): void {
		const i = this.#applied.indexOf(a);
		if (i < 0) return;
		this.#applied.splice(i, 1);
		a.resolve(st);
		if (st.status === 'not-scheduled' || st.status === 'failed') {
			this.#bars.notScheduled(a.task, a.seq);
		} else {
			this.#bars.drop(a.task, a.seq);
		}
		this.#toasts.settle(a.toast, st);
		this.#publish();
	}

	/** A toast closed: a bar it marked "not scheduled" goes back to normal. */
	#closed(t: Toast): void {
		if (this.#bars.clearNotScheduled(t.id)) this.#publish();
	}

	#dropBar(job: Job): void {
		if (this.#bars.drop(job.preview?.task, job.seq)) this.#publish();
	}

	#publish(): void {
		const byTask = this.#bars.snapshot();
		const renames = new Map<TaskId, TaskId>();
		for (const a of this.#applied) if (a.rename) renames.set(a.rename[0], a.rename[1]);
		this.#pending = { byTask, renames, count: this.#applied.length };
	}

	/** A located range in the text as it is now. */
	#now(l: Located): SourceRange | null {
		let cs;
		try {
			cs = this.#d.workspace.changesSince(l.version).get(l.file);
		} catch {
			return null;
		}
		const from = cs ? cs.mapPos(l.from, 1) : l.from;
		const to = cs ? cs.mapPos(l.to, -1) : l.to;
		return { file: l.file, from, to: Math.max(from, to) };
	}
}

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
 *     `settled` resolves with the `Settlement` (edits-settle.ts):
 *     - `scheduled`;
 *     - `new-error`: it schedules (the bar follows the new result) but the result has an error the
 *       good run before did not have; the toast says so with Show;
 *     - `not-scheduled`: the result does not schedule (11.2), with its first error and place;
 *     - `failed`: the run failed, or the engine gave up (also for an edit made while it is down);
 *     - `undone`: undone before a result included it, also when it was then redone (the redo is
 *       an apply of the history's own, with no toast);
 *     - `replaced`: a newer total of its coalesced gesture replaced it;
 *     - `dropped`: the plan closed;
 *   - `refused`: the Gantt's or the edit API's reason, its sentence and its place in the text; a
 *     toast with "Show in text" is up. `needs-schedule` ("wait for the schedule") is refused at
 *     once, like any other reason; only `stale` is planned again;
 *   - `noop`: nothing to change (a short toast said so);
 *   - `ask-move-preference`: ask once (`ganttActionStrings.movePreference`, pre-selecting
 *     `suggested`), call `setMovePreference(kind)`, then dispatch the same action again;
 *   - `confirm-shared`: the change edits text read in several places (`affects` lists the ids);
 *     ask, then dispatch again with `confirmShared: true`;
 *   - `cancelled`: a newer call of the same gesture replaced it before it ran, its gesture was
 *     broken, or the plan closed.
 * - **Coalescing** (keyboard nudges, stepper presses; 6.8 step 6, 19.7; coalesce.ts): a
 *   `coalesceKey` names a gesture, from its first call until `flush(key)`. Call `flush(key)` on
 *   blur and on Enter: it dispatches the held call now and ends the gesture.
 *   - Every call sends the cumulative total since the gesture began (`move` by 3 days after three
 *     presses), never the step; reset the total only when you call `flush(key)`.
 *   - Calls within `COALESCE_MS` keep only the newest (its preview shows); it is dispatched after
 *     300 ms of quiet. A later total in the same gesture replaces the gesture's edit (it is
 *     undone, then the new total is planned on the text from before the gesture), so a gesture
 *     is one undo step and +3 then +4 gives +4, whatever the timing.
 *   - A total of zero (`size-step` 0, `move` 0) takes the gesture's edit out: the text is as it
 *     was before the gesture, and the call answers `noop` without a toast.
 *   - When something else has become the newest undo step meanwhile (typing, Mod-Z), the gesture
 *     is broken: its next call is refused as `stale`, the rest are `cancelled` until `flush`.
 * - **Renames**: while a `moveTask` is pending, `pending.renames` maps the old id to the new one.
 * - **Toasts** (`toasts`, newest last; toasts.svelte.ts): `undoToast(id)` does what Mod-Z does,
 *   only while that toast's entry is the top of the history (`canUndo`); `showToast(id)` reveals
 *   its place in the text; `dismissToast(id)` closes it.
 *
 * ## Order of work for one call
 *
 * 0. A later call of a gesture whose edit is in the text: dry-run the total on the gesture's base;
 *    if it is refused, refuse and keep the edit; otherwise undo the edit (after the Android gate).
 * 1. A fresh index (`ensureIndex`; if it throws, `unprepared`), the plan and `applyIntent` on the
 *    current snapshot (edits-plan.ts). `stale` plans again.
 * 2. The Android gate: if a file the edit changes is the one the editor shows and CodeMirror
 *    holds an Android key there, wait (16 ms steps, about 500 ms at most; tjp/cm/android-key.ts).
 * 3. If the workspace moved meanwhile (typing), plan again from 1: a stale patch is never applied
 *    (and `Workspace.apply` checks every base version too). After three plans: `stale`.
 * 4. `applyEdit`, naming the history entry with the label; the toast; the pending record, keyed
 *    by the workspace version it produced; the one-time constraint warning (gantt/prefs.ts).
 * 5. Settle on the runner's first state that includes that version (edits-settle.ts, the rule in
 *    workspace/run-types.ts), or `undone` / `replaced` when the history undoes it first.
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
import { ganttActionStrings, toastStrings } from '../strings';
import { afterAndroidKey, type KeyTimers } from '../tjp/cm/android-key';
import { applyEdit } from '../tjp/edit/apply';
import type { EditIntent } from '../tjp/edit/types';
import { historyLabel } from '../workspace/history';
import type { WorkspacePath } from '../workspace/paths';
import type { RunnerState } from '../workspace/run-types';
import { Coalescer, type Gesture } from './coalesce';
import { isZeroTotal, movedId, prepare, refused, type Prepared } from './edits-plan';
import { errorIdsOf, rangeNow, type Located } from './edits-settle';
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
import { Ledger } from './ledger.svelte';
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
const stale = (): DispatchOutcome => refused('stale', [], refusalMessage('stale'));
/** A gesture back at its start: the text is as before it (no toast). */
const BACK: DispatchOutcome = {
	status: 'noop',
	reason: 'already-set',
	message: ganttActionStrings.noop['already-set'],
};

const globalTimers: KeyTimers = {
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
};

export class EditDispatcher {
	readonly #toasts: Toasts;
	readonly #ledger: Ledger;
	readonly #d: EditDispatcherDeps;
	readonly #timers: KeyTimers;
	readonly #co: Coalescer<Job, DispatchOutcome>;
	readonly #off: Array<() => void>;
	#state: RunnerState | null = null;
	#chain: Promise<unknown> = Promise.resolve();
	#seq = 0;
	#disposed = false;
	/** The entry being undone to replace it with a newer total of its gesture. */
	#replacing: string | null = null;

	constructor(deps: EditDispatcherDeps) {
		this.#d = deps;
		this.#timers = deps.timers ?? globalTimers;
		this.#toasts = new Toasts(this.#timers, (t) => this.#ledger.closed(t.id));
		this.#ledger = new Ledger(this.#toasts);
		this.#co = new Coalescer(this.#timers, COALESCE_MS, (key) => this.#dispatchHeld(key));
		this.#off = [
			deps.runner.subscribe((s) => {
				this.#state = s;
				this.#ledger.onRunner(s);
			}),
			deps.history.subscribe(() => this.#onHistory()),
		];
	}

	get pending(): PendingEdits {
		return this.#ledger.pending;
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

	/**
	 * Dispatches the held call of `key` now and ends its gesture (every key when omitted): on blur
	 * and Enter. The caller's next call with the key begins a new total.
	 */
	flush(key?: string): void {
		this.#dispatchHeld(key);
		for (const k of key === undefined ? this.#co.keys() : [key]) this.#co.end(k);
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
		const r = at ? rangeNow(this.#d.workspace, at) : null;
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
		for (const h of this.#co.clear()) h.resolve(CANCELLED);
		this.#ledger.dispose();
		this.#toasts.clear();
	}

	#enqueue(job: Job): Promise<DispatchOutcome> {
		if (this.#disposed) return Promise.resolve(CANCELLED);
		if (job.preview) this.#ledger.bar(job.preview, 'preview', job.seq);
		const key = job.o.coalesceKey;
		if (key === undefined) return this.#serial(job);
		const gesture = this.#co.gesture(key);
		return new Promise((resolve) => {
			const prev = this.#co.hold(key, { ...job, gesture }, resolve);
			if (!prev) return;
			this.#dropBar(prev.job);
			prev.resolve(CANCELLED);
		});
	}

	#dispatchHeld(key?: string): void {
		for (const h of this.#co.take(key)) void this.#serial(h.job).then(h.resolve);
	}

	#serial(job: Job): Promise<DispatchOutcome> {
		const run = this.#chain.then(() => this.#run(job));
		this.#chain = run.catch(() => undefined);
		return run;
	}

	async #run(job: Job): Promise<DispatchOutcome> {
		const g = job.gesture;
		if (g?.broken) return this.#done(job, CANCELLED);
		if (g?.applied) {
			const r = await this.#unwind(job, g);
			if (r) return r;
		} else if (g && isZeroTotal(job)) {
			// Back to where the gesture began, with nothing of it in the text.
			this.#dropBar(job);
			return BACK;
		}
		let last: Extract<Prepared, { status: 'replan' }> | null = null;
		for (let plans = 0; plans < MAX_PLANS; plans++) {
			if (this.#disposed) return this.#done(job, CANCELLED);
			const p = prepare(this.#d, job);
			if (p.status === 'replan') {
				last = p;
				continue;
			}
			if (p.status === 'done') return this.#done(job, p.outcome, p.at);
			await this.#gate(Object.keys(p.edit.changes));
			if (this.#disposed) return this.#done(job, CANCELLED);
			// Typing (the held key, say) may have moved the text: plan again, never apply stale.
			if (this.#d.workspace.snapshot().version !== p.version) continue;
			const applied = applyEdit(this.#d.workspace, p.edit, {
				annotations: [historyLabel.of(p.label.text)],
			});
			if (applied === 'stale') continue;
			return this.#record(job, p);
		}
		return last ? this.#done(job, last.outcome, last.at) : this.#done(job, stale());
	}

	/**
	 * Step 0: takes the gesture's edit out of the text so that the newer total replaces it. Null to
	 * go on; an outcome when the call ends here (refused, broken, or back to the gesture's start).
	 */
	async #unwind(job: Job, g: Gesture): Promise<DispatchOutcome | null> {
		const broken = (): DispatchOutcome => {
			g.broken = true;
			return this.#done(job, stale());
		};
		const top = this.#d.history.top();
		if (!top || top.id !== g.applied || !g.base) return broken();
		const zero = isZeroTotal(job);
		const dry = zero ? null : prepare(this.#d, job, g.base);
		const back = zero || (dry?.status === 'done' && dry.outcome.status === 'noop');
		if (dry && dry.status !== 'ready' && !back) {
			return this.#done(job, dry.outcome, dry.status === 'done' ? dry.at : undefined);
		}
		await this.#gate(Object.keys(top.applied.edit.changes));
		if (this.#disposed) return this.#done(job, CANCELLED);
		if (this.#d.history.top()?.id !== g.applied) return broken();
		this.#replacing = g.applied;
		const o = this.#d.history.undo();
		this.#replacing = null;
		if (o.status !== 'done') return broken();
		g.applied = null;
		if (!back) return null;
		// The total is back to zero: the text is as it was before the gesture.
		this.#dropBar(job);
		return dry?.status === 'done' ? dry.outcome : BACK;
	}

	/** Waits while the editor holds an Android key in one of `paths` (tjp/cm/android-key.ts). */
	async #gate(paths: readonly WorkspacePath[]): Promise<void> {
		const held = this.#d.keyHeld;
		if (!held?.(paths)) return;
		await new Promise<void>((go) => afterAndroidKey(() => held(paths), go, this.#timers));
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
		if (job.preview) this.#ledger.bar(job.preview, 'pending', job.seq, toast);
		if (job.gesture) {
			job.gesture.base ??= p.on;
			job.gesture.applied = p.edit.id;
		}
		const settled = this.#ledger.add(
			{
				seq: job.seq,
				entry: p.edit.id,
				version,
				baseline: errorIdsOf(this.#state?.lastGood?.result),
				toast,
				task: job.preview?.task ?? null,
				rename:
					intent.type === 'moveTask' ? [intent.task, movedId(intent.task, intent.parent)] : null,
			},
			this.#state,
		);
		this.#onHistory();
		return { status: 'applied', edit: p.edit, entry: p.edit.id, version, toast, settled };
	}

	#onHistory(): void {
		const undone = this.#d.history.redoTop()?.id ?? null;
		if (undone !== null) {
			this.#ledger.undone(undone, undone === this.#replacing);
			this.#toasts.removeEntry(undone);
		}
		this.#toasts.setTop(this.#d.history.top()?.id ?? null);
	}

	#dropBar(job: Job): void {
		this.#ledger.dropBar(job.preview?.task, job.seq);
	}
}

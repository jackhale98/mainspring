// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The schedule runner (phase-1.md 6.8, phase-2.md 6.9): keeps the engine's view of the plan up to
 * date while the text changes, and publishes what the status strip, the outline, the Gantt and
 * the lint layer show. The contract the edit dispatcher builds on is in run-types.ts.
 *
 * Runs
 * - The runner subscribes to the workspace (15.7). A change with origin 'typing' waits for
 *   `debounceMs` (300) of quiet. 'intent', 'format' and 'history' (an undo or redo) post the
 *   request in the change's own task, before anything is derived: it needs only the text. So
 *   does the start (`runAtStart`), and `changed('now')` (a retry button).
 * - Each run sends the full workspace text (`scheduleRequestOf`, never `options.now`) with a new
 *   revision, and keeps the snapshot it sent until the outcome. The runner must be the only
 *   caller of `schedule` on its client: revisions count up per client (shared by runners on the
 *   same client, one after another), and another caller's revisions make `schedule` reject. A
 *   run is not sent again while one for the same workspace version is still open.
 * - Latest-wins is the engine client's: a run waiting behind another is replaced by a newer one
 *   ('superseded'); a finished run with a newer one open arrives with `latest: false` and still
 *   updates everything shown, while the status stays 'scheduling'. Outcomes older than a result
 *   already received are ignored.
 *
 * Results
 * - A result is shown in an idle task, in one published state with its engine diagnostics:
 *   placed in the snapshot that was sent, mapped through the edits made since (stale until the
 *   next result) and merged with the local diagnostics of the current text. The index follows
 *   with the result's hints, mapped the same way: a line touched since the run has no hint.
 * - `ok: false` keeps `lastGood` (and its finish date) from the previous good run; `outdated`
 *   tells the status strip to dim them. A failed run (crash, timeout, bridge error) leaves every
 *   result in place and sets `failure`; the client restarts its worker, and the next change
 *   runs again (the runner does not retry by itself: the same text would fail the same way).
 * - The runner never schedules anything itself: finish dates and hints are read from results.
 *
 * Derived state (run-derive.ts, run-view.ts)
 * - A typed change updates engine diagnostic positions and syntax diagnostics at once
 *   (`quickView`). Everything else is derived in idle tasks (`requestIdle`, at most
 *   `IDLE_TIMEOUT_MS` later), a step or a few at a time (`sliceMs`), so that no task handles a
 *   whole result or a whole index (6.9): show a waiting result, scan a changed file, link the
 *   index, check values. A step that changes what is shown ends its task and is published, so
 *   the listeners' work lands in its own task too.
 * - The steps that follow the text wait while typing goes on: until `TYPING_PAUSE_MS` without a
 *   keystroke, or `MAX_TYPING_WAIT_MS` after the first keystroke of a burst that never pauses,
 *   so in ordinary typing they fall in a pause. Until then `indexVersion` is behind `version`.
 *   An intent, format or history change ends the wait; showing a result never waits.
 * - `ensureIndex()` derives the index now when it lags, without publishing (run-types.ts).
 * - An exception while deriving keeps the previous view and is rethrown asynchronously, so it
 *   never breaks `Workspace.commit` or other subscribers; listener exceptions are handled the
 *   same way, after every listener has run.
 * - `subscribe` follows the Svelte store contract: the listener is called at once and on every
 *   change; a state equal to the last one published is not published again.
 */
import type { EngineClient, EngineState, ScheduleOutcome } from '../../engine/client';
import type { Revision } from '../../engine/protocol';
import { report } from '../report';
import { finishOf } from '../schedule/finish';
import type { SymbolIndex } from '../tjp/index';
import { Deriver, type Sent, type Shown } from './run-derive';
import {
	DEFAULT_DEBOUNCE_MS,
	defaultTimers,
	IDLE_TIMEOUT_MS,
	MAX_TYPING_WAIT_MS,
	measureTask,
	SLICE_MS,
	TYPING_PAUSE_MS,
	type RunnerFailure,
	type RunnerListener,
	type RunnerState,
	type RunRecord,
	type ScheduleRunner,
	type ScheduleRunnerOptions,
	type Timers,
} from './run-types';
import { runnerStatus } from './run-view';
import { scheduleRequestOf, type ChangeOrigin, type Workspace } from './workspace';

export type { DiagnosticCounts, RunnerStatus } from './run-view';
export * from './run-types';

/** The last revision used per client: revisions must increase per client (protocol). */
const lastRevision = new WeakMap<EngineClient, Revision>();

export function createScheduleRunner(o: ScheduleRunnerOptions): ScheduleRunner {
	return new Runner(o);
}

/** A timer or idle handle; `armed` because a handle may be any value, 0 included. */
interface Slot {
	armed: boolean;
	handle: unknown;
}

class Runner implements ScheduleRunner {
	readonly #ws: Workspace;
	readonly #client: EngineClient;
	readonly #debounceMs: number;
	readonly #sliceMs: number;
	readonly #timers: Timers;
	readonly #debounceSlot: Slot = { armed: false, handle: null };
	readonly #workSlot: Slot = { armed: false, handle: null };
	/** Armed while typing goes on: until `TYPING_PAUSE_MS` after the last keystroke. */
	readonly #pauseSlot: Slot = { armed: false, handle: null };
	/** Caps the pause: set at the first keystroke of a burst, cleared when the index catches up. */
	readonly #capSlot: Slot = { armed: false, handle: null };
	#capPassed = false;
	readonly #open = new Map<Revision, Sent>();
	/** Newest revision whose result arrived. */
	#received: Revision = 0;
	#latest: RunRecord | null = null;
	#lastGood: RunRecord | null = null;
	#failure: RunnerFailure | null = null;
	readonly #derive: Deriver;
	#engine: EngineState;
	#state: RunnerState;
	readonly #listeners = new Set<RunnerListener>();
	readonly #unsubscribe: Array<() => void> = [];
	#depth = 0;
	#disposed = false;

	constructor(o: ScheduleRunnerOptions) {
		this.#ws = o.workspace;
		this.#client = o.client;
		this.#debounceMs = o.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		this.#sliceMs = o.sliceMs ?? SLICE_MS;
		this.#timers = defaultTimers(o.timers ?? {});
		// The request first: the first schedule does not wait for the first index.
		if (o.runAtStart ?? true) this.#runNow();
		this.#derive = new Deriver(this.#ws, o.zones, () => this.#timers.now());
		this.#engine = o.client.state;
		this.#state = this.#compose();
		this.#unsubscribe.push(
			this.#ws.subscribe((_snap, origin) => this.#onChange(origin)),
			this.#client.onState((s) => this.#batch(() => (this.#engine = s))),
		);
	}

	get state(): RunnerState {
		return this.#state;
	}

	ensureIndex(): SymbolIndex {
		return this.#derive.ensureIndex();
	}

	changed(kind: 'typing' | 'now'): void {
		if (this.#disposed) return;
		this.#batch(() => (kind === 'typing' ? this.#debounce() : this.#runNow()));
	}

	subscribe(l: RunnerListener): () => void {
		this.#listeners.add(l);
		l(this.#state);
		return () => {
			this.#listeners.delete(l);
		};
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#clear(this.#debounceSlot, this.#timers.clearTimeout);
		this.#clear(this.#pauseSlot, this.#timers.clearTimeout);
		this.#clear(this.#capSlot, this.#timers.clearTimeout);
		this.#clear(this.#workSlot, this.#timers.cancelIdle);
		for (const u of this.#unsubscribe.splice(0)) u();
		for (const revision of [...this.#open.keys()]) this.#client.cancel(revision);
		this.#open.clear();
		this.#listeners.clear();
	}

	#onChange(origin: ChangeOrigin): void {
		if (this.#disposed) return;
		this.#batch(() => {
			if (origin === 'typing') {
				this.#derive.typed();
				this.#typingGoesOn();
				this.#debounce();
			} else {
				// 'intent', 'format', 'history': post first, derive in the next idle tasks.
				const start = this.#timers.now();
				this.#runNow();
				measureTask(start, this.#timers.now(), ['post']);
				this.#typingStopped();
				this.#kick();
			}
		});
	}

	/** Every keystroke restarts the pause; the cap is set at the first keystroke of a burst. */
	#typingGoesOn(): void {
		const pause = this.#pauseSlot;
		this.#clear(pause, this.#timers.clearTimeout);
		pause.armed = true;
		pause.handle = this.#timers.setTimeout(() => {
			pause.armed = false;
			this.#kick();
		}, TYPING_PAUSE_MS);
		const cap = this.#capSlot;
		if (cap.armed || this.#capPassed) return;
		cap.armed = true;
		cap.handle = this.#timers.setTimeout(() => {
			cap.armed = false;
			this.#capPassed = true;
			this.#kick();
		}, MAX_TYPING_WAIT_MS);
	}

	#typingStopped(): void {
		this.#clear(this.#pauseSlot, this.#timers.clearTimeout);
		this.#clear(this.#capSlot, this.#timers.clearTimeout);
		this.#capPassed = false;
	}

	/** Whether the steps that follow the text may run (module comment). */
	#follow(): boolean {
		return !this.#pauseSlot.armed || this.#capPassed;
	}

	/** Asks for an idle task when a derive step is due and none is asked for. */
	#kick(): void {
		const slot = this.#workSlot;
		if (slot.armed || this.#disposed || !this.#derive.due(this.#follow())) return;
		slot.armed = true;
		slot.handle = this.#timers.requestIdle(() => {
			slot.armed = false;
			if (this.#disposed) return;
			this.#batch(() => this.#work());
			this.#kick();
		}, IDLE_TIMEOUT_MS);
	}

	/** One idle task: steps until one changes what is shown or the slice is used up. */
	#work(): void {
		const d = this.#derive;
		const start = this.#timers.now();
		const steps: string[] = [];
		d.beginTask();
		for (;;) {
			const out = d.step(this.#follow());
			if (!out) break;
			steps.push(out.kind);
			if (out.kind === 'shown') this.#show(out.shown);
			// Caught up with the text: the next keystroke starts a new burst (and a new cap).
			if (d.indexCurrent) this.#typingStopped();
			if (out.kind !== 'work' || this.#timers.now() - start >= this.#sliceMs) break;
		}
		d.endTask();
		if (steps.length > 0) measureTask(start, this.#timers.now(), steps);
	}

	#debounce(): void {
		const slot = this.#debounceSlot;
		this.#clear(slot, this.#timers.clearTimeout);
		slot.armed = true;
		slot.handle = this.#timers.setTimeout(() => {
			slot.armed = false;
			if (!this.#disposed) this.#batch(() => this.#runNow());
		}, this.#debounceMs);
	}

	#clear(slot: Slot, cancel: (handle: unknown) => void): void {
		if (!slot.armed) return;
		cancel(slot.handle);
		slot.armed = false;
	}

	#runNow(): void {
		this.#clear(this.#debounceSlot, this.#timers.clearTimeout);
		const snapshot = this.#ws.snapshot();
		for (const s of this.#open.values()) if (s.snapshot.version === snapshot.version) return;
		const revision = (lastRevision.get(this.#client) ?? 0) + 1;
		lastRevision.set(this.#client, revision);
		const sent: Sent = { revision, snapshot, at: this.#timers.now() };
		this.#open.set(revision, sent);
		this.#client.schedule(scheduleRequestOf(this.#ws, revision)).then(
			(outcome) => this.#settled(sent, outcome),
			(error: unknown) =>
				this.#settled(sent, {
					status: 'failed',
					revision,
					error: { kind: 'internal', message: String(error) },
				}),
		);
	}

	#settled(sent: Sent, outcome: ScheduleOutcome): void {
		if (this.#disposed) return;
		this.#batch(() => {
			this.#open.delete(sent.revision);
			if (sent.revision <= this.#received) return;
			if (outcome.status === 'done') {
				this.#received = sent.revision;
				this.#derive.accept({
					sent,
					result: outcome.result,
					latest: outcome.latest,
					at: this.#timers.now(),
				});
				this.#kick();
			} else if (outcome.status === 'failed') {
				if (!this.#failure || sent.revision > this.#failure.revision) {
					this.#failure = { revision: sent.revision, error: outcome.error };
				}
			}
		});
	}

	/** Records a result the derive step just showed. */
	#show(s: Shown): void {
		const { sent, result, latest, at } = s.arrival;
		const record: RunRecord = {
			revision: sent.revision,
			workspaceVersion: sent.snapshot.version,
			result,
			latest,
			diagnostics: s.diagnostics,
			hints: s.hints,
			finish: finishOf(result, this.#lastGood?.finish ?? null),
			timings: {
				engine: result.timings,
				roundTripMs: at - sent.at,
				processMs: s.processMs,
				longestTaskMs: s.longestTaskMs,
				shownMs: this.#timers.now() - at,
			},
		};
		this.#latest = record;
		if (result.ok) this.#lastGood = record;
		if (this.#failure && this.#failure.revision < sent.revision) this.#failure = null;
	}

	/** Runs `fn`, then publishes once; nested calls publish when the outermost one ends. */
	#batch(fn: () => void): void {
		this.#depth++;
		try {
			fn();
		} finally {
			this.#depth--;
			if (this.#depth === 0) this.#publish();
		}
	}

	#publish(): void {
		if (this.#disposed) return;
		const next = this.#compose();
		if (sameState(next, this.#state)) return;
		this.#state = next;
		for (const l of [...this.#listeners]) {
			try {
				l(next);
			} catch (error) {
				report(error);
			}
		}
	}

	#compose(): RunnerState {
		const pending = this.#debounceSlot.armed || this.#open.size > 0 || this.#derive.waiting > 0;
		const latest = this.#latest;
		const lastGood = this.#lastGood;
		const failure = this.#failure;
		const view = this.#derive.view;
		const status = runnerStatus({
			engine: this.#engine,
			pending,
			failed: failure !== null,
			latestOk: latest?.result.ok ?? null,
			errors: view.counts.errors,
		});
		const outdated =
			lastGood !== null &&
			(latest !== lastGood || (failure !== null && failure.revision > lastGood.revision));
		return {
			status,
			engine: this.#engine,
			pending,
			version: view.version,
			indexVersion: view.indexVersion,
			latest,
			lastGood,
			outdated,
			diagnostics: view.diagnostics,
			counts: view.counts,
			hints: view.hints,
			index: view.index,
			finish: lastGood?.finish ?? null,
			timings: latest?.timings ?? null,
			failure,
		};
	}
}

/** Two states that show the same: every field identical. */
function sameState(a: RunnerState, b: RunnerState): boolean {
	const keys = Object.keys(a) as Array<keyof RunnerState>;
	return keys.every((k) => a[k] === b[k]);
}

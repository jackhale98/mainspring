// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The schedule runner (phase-1.md 6.8): keeps the engine's view of the plan up to date while the
 * text changes, and publishes what the status strip, the outline and the lint layer show.
 *
 * Runs
 * - The runner subscribes to the workspace (15.7). A change with origin 'typing' waits for
 *   `debounceMs` (300) of quiet; 'format' and 'intent' changes are scheduled at once, and so is
 *   the workspace as it is when the runner starts (`runAtStart`). `changed()` asks for the same
 *   from outside (a retry button); workspace edits never need it.
 * - Each run sends the full workspace text (`scheduleRequestOf`, never `options.now`) with a new
 *   revision, and keeps the snapshot it sent until the outcome. The runner must be the only
 *   caller of `schedule` on its client: revisions count up per client (shared by runners on the
 *   same client, one after another), and another caller's revisions make `schedule` reject. A
 *   run is not sent again while one for the same workspace version is still open.
 * - Latest-wins is the engine client's: a run waiting behind another is replaced by a newer one
 *   ('superseded'); a finished run with a newer one open arrives with `latest: false` and still
 *   updates everything shown, while the status stays 'scheduling'. Outcomes older than a result
 *   already handled are ignored.
 *
 * Results
 * - Engine diagnostics are placed in the snapshot that was sent (`engineDiagnostics`), then
 *   mapped through the edits made since (stale until the next result) and merged with the local
 *   diagnostics of the current text (run-view.ts). The index is built with the result's engine
 *   hints, mapped the same way: a line touched since the run has no hint.
 * - `ok: false` keeps `lastGood` (and its finish date) from the previous good run; `outdated`
 *   tells the status strip to dim them. A failed run (crash, timeout, bridge error) leaves every
 *   result in place and sets `failure`; the client restarts its worker, and the next change
 *   runs again (the runner does not retry by itself: the same text would fail the same way).
 * - The runner never schedules anything itself: finish dates and hints are read from results.
 *
 * Derived state
 * - A typed change updates engine diagnostic positions and syntax diagnostics at once
 *   (`quickView`); the index, hints and value/attribute checks follow in one idle task
 *   (`requestIdle`, at most `IDLE_TIMEOUT_MS` later) that covers every keystroke before it.
 *   Until then `indexVersion` is behind `version`. Format and intent edits, results and the
 *   start derive everything at once (`fullView`).
 * - An exception while deriving keeps the previous view and is rethrown asynchronously, so it
 *   never breaks `Workspace.commit` or other subscribers; listener exceptions are handled the
 *   same way, after every listener has run.
 * - `subscribe` follows the Svelte store contract: the listener is called at once and on every
 *   change.
 */
import type { EngineClient, EngineState, ScheduleOutcome } from '../../engine/client';
import type { Revision, ScheduleResult } from '../../engine/protocol';
import { finishOf } from '../schedule/finish';
import { engineDiagnostics, type TjpDiagnostic } from '../tjp/diagnostics';
import { buildIndex, NO_HINTS, type EngineHints, type SymbolIndex } from '../tjp/index';
import {
	DEFAULT_DEBOUNCE_MS,
	defaultTimers,
	IDLE_TIMEOUT_MS,
	type RunnerFailure,
	type RunnerListener,
	type RunnerState,
	type RunRecord,
	type ScheduleRunner,
	type ScheduleRunnerOptions,
	type Timers,
} from './run-types';
import {
	fullView,
	isHintSource,
	prepareIndex,
	quickView,
	runnerStatus,
	sameHints,
	sentHints,
	type DiagnosticBase,
	type HintBase,
	type Prepared,
	type View,
} from './run-view';
import {
	scheduleRequestOf,
	type ChangeOrigin,
	type Workspace,
	type WorkspaceSnapshot,
} from './workspace';

export type { DiagnosticCounts, RunnerStatus } from './run-view';
export * from './run-types';

/** The last revision used per client: revisions must increase per client (protocol). */
const lastRevision = new WeakMap<EngineClient, Revision>();

/** Rethrows outside the current call stack, so the caller carries on. */
function report(error: unknown): void {
	queueMicrotask(() => {
		throw error;
	});
}

export function createScheduleRunner(o: ScheduleRunnerOptions): ScheduleRunner {
	return new Runner(o);
}

interface Sent {
	readonly revision: Revision;
	readonly snapshot: WorkspaceSnapshot;
	readonly at: number;
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
	readonly #timers: Timers;
	readonly #debounceSlot: Slot = { armed: false, handle: null };
	readonly #idleSlot: Slot = { armed: false, handle: null };
	readonly #open = new Map<Revision, Sent>();
	/** Newest revision whose result was handled. */
	#handled: Revision = 0;
	#latest: RunRecord | null = null;
	#lastGood: RunRecord | null = null;
	#failure: RunnerFailure | null = null;
	#hintBase: HintBase | null = null;
	#diagnosticBase: DiagnosticBase | null = null;
	#engine: EngineState;
	#view: View;
	#state: RunnerState;
	readonly #listeners = new Set<RunnerListener>();
	readonly #unsubscribe: Array<() => void> = [];
	#depth = 0;
	#disposed = false;

	constructor(o: ScheduleRunnerOptions) {
		this.#ws = o.workspace;
		this.#client = o.client;
		this.#debounceMs = o.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		this.#timers = defaultTimers(o.timers ?? {});
		this.#engine = o.client.state;
		this.#view = fullView(this.#ws, this.#ws.snapshot(), null, null);
		this.#state = this.#compose();
		this.#unsubscribe.push(
			this.#ws.subscribe((_snap, origin) => this.#onChange(origin)),
			this.#client.onState((s) => this.#batch(() => (this.#engine = s))),
		);
		if (o.runAtStart ?? true) this.#batch(() => this.#runNow());
	}

	get state(): RunnerState {
		return this.#state;
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
		this.#clear(this.#idleSlot, this.#timers.cancelIdle);
		for (const u of this.#unsubscribe.splice(0)) u();
		for (const revision of [...this.#open.keys()]) this.#client.cancel(revision);
		this.#open.clear();
		this.#listeners.clear();
	}

	#onChange(origin: ChangeOrigin): void {
		if (this.#disposed) return;
		this.#batch(() => {
			if (origin === 'typing') {
				this.#derive(() => {
					this.#view = quickView(this.#ws, this.#ws.snapshot(), this.#view, this.#diagnosticBase);
				});
				this.#refreshWhenIdle();
				this.#debounce();
			} else {
				this.#refresh();
				this.#runNow();
			}
		});
	}

	/** Runs `fn`, which replaces the view; on an exception the previous view stays. */
	#derive(fn: () => void): void {
		try {
			fn();
		} catch (error) {
			report(error);
		}
	}

	/** Derives everything for the workspace now; `prepared` is its index part, if known. */
	#refresh(prepared?: Prepared): void {
		this.#clear(this.#idleSlot, this.#timers.cancelIdle);
		this.#derive(() => {
			const now = this.#ws.snapshot();
			this.#view = fullView(this.#ws, now, this.#hintBase, this.#diagnosticBase, prepared);
		});
	}

	#refreshWhenIdle(): void {
		const slot = this.#idleSlot;
		if (slot.armed) return;
		slot.armed = true;
		slot.handle = this.#timers.requestIdle(() => {
			slot.armed = false;
			if (!this.#disposed) this.#batch(() => this.#refresh());
		}, IDLE_TIMEOUT_MS);
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
			if (sent.revision <= this.#handled) return;
			if (outcome.status === 'done') {
				this.#handle(sent, outcome.result, outcome.latest);
			} else if (outcome.status === 'failed') {
				if (!this.#failure || sent.revision > this.#failure.revision) {
					this.#failure = { revision: sent.revision, error: outcome.error };
				}
			}
		});
	}

	#handle(sent: Sent, result: ScheduleResult, latest: boolean): void {
		const t0 = this.#timers.now();
		this.#handled = sent.revision;
		const out: { hints: EngineHints | null; diagnostics: readonly TjpDiagnostic[] } = {
			hints: null,
			diagnostics: [],
		};
		this.#derive(() => {
			const prev = this.#view;
			const now = this.#ws.snapshot();
			const hints = isHintSource(result) ? sentHints(result, sent.snapshot) : null;
			out.hints = hints;
			if (hints) this.#hintBase = { snapshot: sent.snapshot, result, hints };
			const current = prepareIndex(this.#ws, now, this.#hintBase, prev);
			// Engine messages are refined by id in the sent snapshot's index: the current one when
			// nothing changed during the run, else an earlier view's of that version with the same
			// hints, else one built for it. Without messages no index is needed.
			const refine = result.messages.some((m) => m.level !== 'debug');
			const reusable =
				prev.indexVersion === sent.snapshot.version && (!hints || sameHints(prev.hints, hints));
			const sentIndex: SymbolIndex | null = !refine
				? null
				: now.version === sent.snapshot.version
					? current.index
					: reusable
						? prev.index
						: buildIndex(sent.snapshot, hints ?? NO_HINTS);
			out.diagnostics = engineDiagnostics(result, sent.snapshot, sentIndex);
			this.#diagnosticBase = { snapshot: sent.snapshot, diagnostics: out.diagnostics };
			this.#refresh(current);
		});
		const finish = finishOf(result, this.#lastGood?.finish ?? null);
		const record: RunRecord = {
			revision: sent.revision,
			workspaceVersion: sent.snapshot.version,
			result,
			latest,
			diagnostics: out.diagnostics,
			hints: out.hints ?? NO_HINTS,
			finish,
			timings: {
				engine: result.timings,
				roundTripMs: t0 - sent.at,
				processMs: this.#timers.now() - t0,
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
		this.#state = this.#compose();
		for (const l of [...this.#listeners]) {
			try {
				l(this.#state);
			} catch (error) {
				report(error);
			}
		}
	}

	#compose(): RunnerState {
		const pending = this.#debounceSlot.armed || this.#open.size > 0;
		const latest = this.#latest;
		const lastGood = this.#lastGood;
		const failure = this.#failure;
		const view = this.#view;
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

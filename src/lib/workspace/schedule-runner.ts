// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The schedule runner (phase-1.md 6.8): keeps the engine's view of the plan up to date while the
 * text changes, and publishes what the status strip, the outline and the lint layer show.
 *
 * Runs
 * - The runner subscribes to the workspace (15.7). A change with origin 'typing' waits for
 *   `debounceMs` (300) of quiet; 'format' and 'intent' changes are scheduled at once, and so is
 *   the workspace as it is when the runner starts (`runAtStart`). `changed()` asks for the same
 *   from outside (a retry button).
 * - Each run sends the full workspace text (`scheduleRequestOf`, never `options.now`) with a new
 *   revision, and keeps the snapshot it sent until the outcome. Revisions increase per engine
 *   client across runners, so a new runner on the same client keeps working. A run is not sent
 *   again while one for the same workspace version is still open.
 * - Latest-wins is the engine client's: a run waiting behind another is replaced by a newer one
 *   ('superseded'); a finished run with a newer one open arrives with `latest: false` and still
 *   updates everything shown, while the status stays 'scheduling'. Outcomes older than a result
 *   already handled are ignored.
 *
 * Results
 * - Engine diagnostics are placed in the snapshot that was sent (`engineDiagnostics`), then
 *   mapped through the edits made since (stale until the next result) and merged with the local
 *   diagnostics of the current text (run-view.ts). The index of the current text is built with
 *   the result's engine hints, mapped the same way: a line touched since the run has no hint.
 * - `ok: false` keeps `lastGood` (and its finish date) from the previous good run; `outdated`
 *   tells the status strip to dim them. A failed run (crash, timeout, bridge error) leaves every
 *   result in place and sets `failure`; the client restarts its worker, and the next change
 *   runs again (the runner does not retry by itself: the same text would fail the same way).
 * - The runner never schedules anything itself: finish dates and hints are read from results.
 *
 * Derived state is recomputed synchronously on each workspace change and each result.
 * `subscribe` follows the Svelte store contract: the listener is called at once and on every
 * change. Listener exceptions are rethrown asynchronously, after every listener has run.
 */
import type { EngineClient, EngineState, ScheduleOutcome } from '../../engine/client';
import type { EngineError, Revision, ScheduleResult, Timings } from '../../engine/protocol';
import { finishOf, type Finish } from '../schedule/finish';
import { engineDiagnostics, type TjpDiagnostic } from '../tjp/diagnostics';
import { buildIndex, NO_HINTS, type EngineHints, type SymbolIndex } from '../tjp/index';
import {
	indexNow,
	isHintSource,
	sentHints,
	viewNow,
	type DiagnosticBase,
	type DiagnosticCounts,
	type HintBase,
	type View,
} from './run-view';
import {
	scheduleRequestOf,
	type ChangeOrigin,
	type Workspace,
	type WorkspaceSnapshot,
} from './workspace';

export type { DiagnosticCounts } from './run-view';

export type RunnerStatus = 'idle' | 'scheduling' | 'ok' | 'errors' | 'failed';

export interface RunTimings {
	/** The engine's own timings, measured in the worker. */
	readonly engine: Timings;
	/** From sending the request to its outcome on the main thread, queueing included. */
	readonly roundTripMs: number;
	/** Turning the result into diagnostics, hints, the index and the finish date. */
	readonly processMs: number;
}

export interface RunRecord {
	readonly revision: Revision;
	/** The version of the workspace snapshot that was sent. */
	readonly workspaceVersion: number;
	readonly result: ScheduleResult;
	/** False when a newer run was open as this one arrived. */
	readonly latest: boolean;
	/** Engine diagnostics in the texts that were sent (`state.diagnostics` has them mapped). */
	readonly diagnostics: readonly TjpDiagnostic[];
	/** Engine hints in the lines that were sent (`state.hints` has them mapped). */
	readonly hints: EngineHints;
	readonly finish: Finish | null;
	readonly timings: RunTimings;
}

export interface RunnerFailure {
	readonly revision: Revision;
	readonly error: EngineError;
}

export interface RunnerState {
	/**
	 * 'scheduling' while a run waits for the debounce or the engine; otherwise 'failed' when the
	 * newest run failed or the engine is gone, 'errors' when the latest result is not ok or an
	 * error is shown, 'ok', or 'idle' before the first result.
	 */
	readonly status: RunnerStatus;
	readonly engine: EngineState;
	readonly pending: boolean;
	/** The workspace version that `index`, `hints` and `diagnostics` describe. */
	readonly version: number;
	readonly latest: RunRecord | null;
	/** The newest result with `ok: true`. */
	readonly lastGood: RunRecord | null;
	/** True when the newest outcome is not `lastGood` (ok false, or failed): dim it. */
	readonly outdated: boolean;
	/** Engine (mapped) and local diagnostics of the current text, sorted by file and position. */
	readonly diagnostics: readonly TjpDiagnostic[];
	readonly counts: DiagnosticCounts;
	/** Engine hints mapped to the current text. */
	readonly hints: EngineHints;
	/** The index of the current text, built with `hints`. */
	readonly index: SymbolIndex;
	/** `lastGood`'s finish date, with the delta against the good run before it. */
	readonly finish: Finish | null;
	/** The latest result's timings. */
	readonly timings: RunTimings | null;
	readonly failure: RunnerFailure | null;
}

export type RunnerListener = (s: RunnerState) => void;

export interface ScheduleRunner {
	/** 'typing': run after `debounceMs` of quiet; 'now': run at once. Workspace changes call it. */
	changed(kind: 'typing' | 'now'): void;
	readonly state: RunnerState;
	/** Svelte store contract: `l` is called at once with the current state, then on changes. */
	subscribe(l: RunnerListener): () => void;
	/** Stops listening, cancels open runs and drops listeners. The client stays (not owned). */
	dispose(): void;
}

export interface Timers {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	/** Milliseconds, for timings only. */
	now(): number;
}

export interface ScheduleRunnerOptions {
	workspace: Workspace;
	client: EngineClient;
	/** Quiet time after typing before a run; default 300 ms. */
	debounceMs?: number;
	/** Defaults use the global timers at call time, so fake timers apply. */
	timers?: Partial<Timers>;
	/** Schedule the workspace at once when the runner starts; default true. */
	runAtStart?: boolean;
}

export const DEFAULT_DEBOUNCE_MS = 300;

const DEFAULT_TIMERS: Timers = {
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
	now: () => globalThis.performance.now(),
};

/** The last revision used per client: revisions must increase per client (protocol). */
const lastRevision = new WeakMap<EngineClient, Revision>();

export function createScheduleRunner(o: ScheduleRunnerOptions): ScheduleRunner {
	return new Runner(o);
}

interface Sent {
	readonly revision: Revision;
	readonly snapshot: WorkspaceSnapshot;
	readonly at: number;
}

class Runner implements ScheduleRunner {
	readonly #ws: Workspace;
	readonly #client: EngineClient;
	readonly #debounceMs: number;
	readonly #timers: Timers;
	#timer: unknown = null;
	#timerArmed = false;
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
	#dirty = false;
	#disposed = false;

	constructor(o: ScheduleRunnerOptions) {
		this.#ws = o.workspace;
		this.#client = o.client;
		this.#debounceMs = o.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		this.#timers = { ...DEFAULT_TIMERS, ...o.timers };
		this.#engine = o.client.state;
		this.#view = viewNow(this.#ws, this.#ws.snapshot(), null, null);
		this.#state = this.#compose();
		this.#unsubscribe.push(
			this.#ws.subscribe((snap, origin) => this.#onChange(snap, origin)),
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
		this.#clearTimer();
		for (const u of this.#unsubscribe.splice(0)) u();
		for (const revision of [...this.#open.keys()]) this.#client.cancel(revision);
		this.#open.clear();
		this.#listeners.clear();
	}

	#onChange(snap: WorkspaceSnapshot, origin: ChangeOrigin): void {
		if (this.#disposed) return;
		this.#batch(() => {
			this.#view = viewNow(this.#ws, snap, this.#hintBase, this.#diagnosticBase);
			if (origin === 'typing') this.#debounce();
			else this.#runNow();
		});
	}

	#debounce(): void {
		this.#clearTimer();
		this.#timerArmed = true;
		this.#timer = this.#timers.setTimeout(() => {
			this.#timerArmed = false;
			this.#timer = null;
			if (!this.#disposed) this.#batch(() => this.#runNow());
		}, this.#debounceMs);
	}

	#clearTimer(): void {
		if (!this.#timerArmed) return;
		this.#timers.clearTimeout(this.#timer);
		this.#timerArmed = false;
		this.#timer = null;
	}

	#runNow(): void {
		this.#clearTimer();
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
					error: { kind: 'invalid-request', message: String(error) },
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
		const roundTripMs = t0 - sent.at;
		this.#handled = sent.revision;
		const now = this.#ws.snapshot();
		const hints = isHintSource(result) ? sentHints(result, sent.snapshot) : null;
		if (hints) this.#hintBase = { snapshot: sent.snapshot, result, hints };
		// The sent snapshot's index refines engine messages by id; it is the current one when
		// nothing changed during the run.
		const current = indexNow(this.#ws, now, this.#hintBase);
		const sentIndex: SymbolIndex =
			now.version === sent.snapshot.version
				? current.index
				: buildIndex(sent.snapshot, hints ?? NO_HINTS);
		const diagnostics = engineDiagnostics(result, sent.snapshot, sentIndex);
		this.#diagnosticBase = { snapshot: sent.snapshot, diagnostics };
		this.#view = viewNow(this.#ws, now, this.#hintBase, this.#diagnosticBase, current);
		const finish = finishOf(result, this.#lastGood?.finish ?? null);
		const record: RunRecord = {
			revision: sent.revision,
			workspaceVersion: sent.snapshot.version,
			result,
			latest,
			diagnostics,
			hints: hints ?? NO_HINTS,
			finish,
			timings: { engine: result.timings, roundTripMs, processMs: this.#timers.now() - t0 },
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
			this.#dirty = true;
			if (this.#depth === 0) this.#publish();
		}
	}

	#publish(): void {
		if (!this.#dirty || this.#disposed) return;
		this.#dirty = false;
		this.#state = this.#compose();
		const errors: unknown[] = [];
		for (const l of [...this.#listeners]) {
			try {
				l(this.#state);
			} catch (error) {
				errors.push(error);
			}
		}
		for (const error of errors) {
			queueMicrotask(() => {
				throw error;
			});
		}
	}

	#compose(): RunnerState {
		const pending = this.#timerArmed || this.#open.size > 0;
		const latest = this.#latest;
		const lastGood = this.#lastGood;
		const failure = this.#failure;
		const view = this.#view;
		const status: RunnerStatus =
			this.#engine === 'failed'
				? 'failed'
				: pending
					? 'scheduling'
					: failure
						? 'failed'
						: latest === null
							? 'idle'
							: !latest.result.ok || view.counts.errors > 0
								? 'errors'
								: 'ok';
		const outdated =
			lastGood !== null &&
			(latest !== lastGood || (failure !== null && failure.revision > lastGood.revision));
		return {
			status,
			engine: this.#engine,
			pending,
			version: view.version,
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

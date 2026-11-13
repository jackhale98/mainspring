// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The schedule runner's public types and timer defaults (phase-1.md 6.8, 15.17; phase-2.md 6.9),
 * apart from the runner itself (schedule-runner.ts, which re-exports all of them) to keep that
 * file short.
 *
 * Contract for the edit dispatcher (phase-2.md 6.8, T13). These members are stable:
 * - `ensureIndex()` returns an index of the workspace as it is now (`index.version` equals
 *   `workspace.snapshot().version`), built at once when `state.index` lags. It does not publish:
 *   `state` catches up in the runner's own idle tasks and reuses that index while the text is
 *   unchanged. Call it right before `applyIntent`.
 * - Origins 'intent', 'format' and 'history' (an undo or redo) post the schedule request in the
 *   change's own task and publish `pending: true` at once; the view (`index`, `diagnostics`, their
 *   versions) follows in idle tasks. 'typing' waits for `debounceMs` of quiet before it posts.
 * - A result is shown by one published state that holds its `latest` record and its engine
 *   diagnostics together. The edit an intent made is settled by the first state whose
 *   `latest.workspaceVersion` is at least the version that edit produced (`result.ok` and the
 *   error ids tell whether it still schedules).
 */
import type { EngineClient, EngineState } from '../../engine/client';
import type { EngineError, Revision, ScheduleResult, Timings } from '../../engine/protocol';
import type { Finish } from '../schedule/finish';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import type { EngineHints, SymbolIndex } from '../tjp/index';
import type { DiagnosticCounts, RunnerStatus } from './run-view';
import type { ZoneOffsets } from '../tjp/values';
import type { Workspace } from './workspace';

export type { ChangeOrigin } from './workspace';

export interface ScheduleRunner {
	/**
	 * The index of the workspace as it is now, derived at once if `state.index` lags (typing, or a
	 * change whose view is still being derived). Not published; see the module comment.
	 */
	ensureIndex(): SymbolIndex;
	/**
	 * 'typing': run after `debounceMs` of quiet; 'now': run at once. Workspace changes need no
	 * call (the runner subscribes); this is for a retry button and the like.
	 */
	changed(kind: 'typing' | 'now'): void;
	readonly state: RunnerState;
	/** Svelte store contract: `l` is called at once with the current state, then on changes. */
	subscribe(l: RunnerListener): () => void;
	/** Stops listening, cancels open runs and drops listeners. The client stays (not owned). */
	dispose(): void;
}

export interface RunTimings {
	/** The engine's own timings, measured in the worker. */
	readonly engine: Timings;
	/** From sending the request to its outcome on the main thread, queueing included. */
	readonly roundTripMs: number;
	/**
	 * Main-thread time the runner spent from the outcome's arrival to the state that shows it:
	 * engine diagnostics, hints, and any index and checks it derived meanwhile.
	 */
	readonly processMs: number;
	/** The longest single task of that work; idle tasks keep it short (phase-2.md 6.9). */
	readonly longestTaskMs: number;
	/** From the outcome's arrival to the state that shows it, idle waits included. */
	readonly shownMs: number;
}

export interface RunRecord {
	readonly revision: Revision;
	/** The version of the workspace snapshot that was sent. */
	readonly workspaceVersion: number;
	readonly result: ScheduleResult;
	/** False when a newer run was open as this one arrived. */
	readonly latest: boolean;
	/** Engine diagnostics in the texts that were sent; render `state.diagnostics` instead. */
	readonly diagnostics: readonly TjpDiagnostic[];
	/** Engine hints in the lines that were sent; `state.hints` has them mapped. */
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
	 * 'scheduling' while a run waits for the debounce or the engine, or its result for its turn
	 * to be shown; otherwise 'failed' when the newest run failed or the engine is gone, 'errors'
	 * when the latest result is not ok or an error is shown, 'ok', or 'idle' before the first
	 * result.
	 */
	readonly status: RunnerStatus;
	readonly engine: EngineState;
	readonly pending: boolean;
	/**
	 * The workspace version that `diagnostics` and `counts` describe. Behind the workspace for a
	 * moment after an intent, format or history change (module comment).
	 */
	readonly version: number;
	/** The workspace version that `index` and `hints` describe; at most `version`. */
	readonly indexVersion: number;
	readonly latest: RunRecord | null;
	/** The newest result with `ok: true`. */
	readonly lastGood: RunRecord | null;
	/** True when the newest outcome is not `lastGood` (ok false, or failed): dim it. */
	readonly outdated: boolean;
	/** Engine (mapped) and local diagnostics of the text at `version`, sorted by file and position. */
	readonly diagnostics: readonly TjpDiagnostic[];
	readonly counts: DiagnosticCounts;
	/** Engine hints in the lines of `indexVersion`. */
	readonly hints: EngineHints;
	/** The index of `indexVersion`, built with `hints`. */
	readonly index: SymbolIndex;
	/** `lastGood`'s finish date, with the delta against the good run before it. */
	readonly finish: Finish | null;
	/** The latest result's timings. */
	readonly timings: RunTimings | null;
	readonly failure: RunnerFailure | null;
}

export type RunnerListener = (s: RunnerState) => void;

export interface Timers {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	/** Runs `fn` when the main thread is idle, at most `timeoutMs` later. */
	requestIdle(fn: () => void, timeoutMs: number): unknown;
	cancelIdle(handle: unknown): void;
	/** Milliseconds; for timings and for the length of an idle task's work. */
	now(): number;
}

export interface ScheduleRunnerOptions {
	workspace: Workspace;
	/** Used by this runner alone for schedules (schedule-runner.ts module comment). */
	client: EngineClient;
	/** Quiet time after typing before a run; default 300 ms. */
	debounceMs?: number;
	/**
	 * Defaults use the global timers at call time, so fake timers apply. `requestIdle` defaults to
	 * `requestIdleCallback`, or where there is none to `setTimeout` with `IDLE_FALLBACK_MS`.
	 */
	timers?: Partial<Timers>;
	/**
	 * Time-zone data for the symbol index (the engine's `createTimeZoneHost()` fits). Without it
	 * the index cannot check zone names or zone-dependent values (timing resolution against a
	 * zone's offset, aligned dates) and skips those checks as uncheckable; the app passes it.
	 */
	zones?: ZoneOffsets;
	/** Schedule the workspace at once when the runner starts; default true. */
	runAtStart?: boolean;
	/**
	 * How long one idle task may keep taking derive steps (default `SLICE_MS`). A step that
	 * changes the published state always ends its task. 0 takes one step per task (tests).
	 */
	sliceMs?: number;
}

export const DEFAULT_DEBOUNCE_MS = 300;
/**
 * A pause in typing that must pass before the index follows the text. Rebuilding it after every
 * keystroke put a 15 to 40 ms task between keystrokes on large plans (T21 audit).
 */
export const TYPING_PAUSE_MS = 150;
/** The index follows the text at least this often during typing that never pauses. */
export const MAX_TYPING_WAIT_MS = 1000;
/** The longest the runner's idle work then waits for an idle moment. */
export const IDLE_TIMEOUT_MS = 100;
export const IDLE_FALLBACK_MS = 50;
/**
 * One idle task takes further derive steps while it has run for less than this. Each step is
 * at most one file scan, one index link, the value checks or one result's diagnostics; together
 * they stay under 50 ms on `scale-1000` (phase-2.md 6.9).
 */
export const SLICE_MS = 8;

/**
 * Each task of the runner's own (an idle task of derive steps, or the post of an intent, format or
 * history change) is recorded as a `performance` measure with this name; its detail lists the
 * steps (`post`, `shown`, `view`, `work`). For the gate's timings (phase-2.md 6.9, 8.4).
 */
export const RUNNER_MEASURE = 'mainspring:runner-task';

/** `o` completed with the defaults (see ScheduleRunnerOptions.timers). */
export function defaultTimers(o: Partial<Timers>): Timers {
	const setTimeout = o.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
	const clearTimeout =
		o.clearTimeout ??
		((h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>));
	const idle = typeof globalThis.requestIdleCallback === 'function';
	return {
		setTimeout,
		clearTimeout,
		requestIdle:
			o.requestIdle ??
			(idle
				? (fn, timeout) => globalThis.requestIdleCallback(() => fn(), { timeout })
				: (fn) => setTimeout(fn, IDLE_FALLBACK_MS)),
		cancelIdle:
			o.cancelIdle ?? (idle ? (h) => globalThis.cancelIdleCallback(h as number) : clearTimeout),
		now: o.now ?? (() => globalThis.performance.now()),
	};
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The schedule runner's public types and timer defaults (phase-1.md 6.8, 15.17), apart from the
 * runner itself (schedule-runner.ts, which re-exports all of them) to keep that file short.
 */
import type { EngineClient, EngineState } from '../../engine/client';
import type { EngineError, Revision, ScheduleResult, Timings } from '../../engine/protocol';
import type { Finish } from '../schedule/finish';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import type { EngineHints, SymbolIndex } from '../tjp/index';
import type { DiagnosticCounts, RunnerStatus } from './run-view';
import type { ZoneOffsets } from '../tjp/values';
import type { Workspace } from './workspace';

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
	 * 'scheduling' while a run waits for the debounce or the engine; otherwise 'failed' when the
	 * newest run failed or the engine is gone, 'errors' when the latest result is not ok or an
	 * error is shown, 'ok', or 'idle' before the first result.
	 */
	readonly status: RunnerStatus;
	readonly engine: EngineState;
	readonly pending: boolean;
	/** The workspace version that `diagnostics` and `counts` describe. */
	readonly version: number;
	/** The workspace version that `index` and `hints` describe; behind `version` while typing. */
	readonly indexVersion: number;
	readonly latest: RunRecord | null;
	/** The newest result with `ok: true`. */
	readonly lastGood: RunRecord | null;
	/** True when the newest outcome is not `lastGood` (ok false, or failed): dim it. */
	readonly outdated: boolean;
	/** Engine (mapped) and local diagnostics of the current text, sorted by file and position. */
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

export interface ScheduleRunner {
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

export interface Timers {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	/** Runs `fn` when the main thread is idle, at most `timeoutMs` later. */
	requestIdle(fn: () => void, timeoutMs: number): unknown;
	cancelIdle(handle: unknown): void;
	/** Milliseconds, for timings only. */
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
}

export const DEFAULT_DEBOUNCE_MS = 300;
/**
 * A pause in typing that must pass before the index follows the text. Rebuilding it after every
 * keystroke put a 15 to 40 ms task between keystrokes on large plans (T21 audit).
 */
export const TYPING_PAUSE_MS = 150;
/** The index follows the text at least this often during typing that never pauses. */
export const MAX_TYPING_WAIT_MS = 1000;
/** The longest the index then waits for an idle moment. */
export const IDLE_TIMEOUT_MS = 100;
export const IDLE_FALLBACK_MS = 50;

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

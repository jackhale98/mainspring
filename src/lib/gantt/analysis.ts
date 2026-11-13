// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The driving-path analysis for the Gantt (phase-2.md 6.2, 8.3): computed once per engine result,
 * in an idle task, so it never lands in the task that handles a result or paints a frame. The
 * Gantt keeps showing the previous analysis until the new one is ready (the float painter skips a
 * tail that ends before its bar, so a stale one is harmless for that moment).
 *
 * A result's analysis is cached by the result object, so a Gantt that mounts again (a mode
 * switch) gets it at once. Each computation is recorded as a `performance` measure named
 * `ANALYSIS_MEASURE`, with the task count, for the timings in the gate (T5).
 *
 * The analysis is display data (ADR-0007): it only ever reaches the model's critical and float
 * fields, and never the engine.
 */
import type { ScheduleResult } from '../../engine/protocol';
import { analyseResult, type DrivingAnalysis } from '../schedule/critical';

/** Runs a task later and returns a function that cancels it. */
export type Scheduler = (task: () => void) => () => void;

export const ANALYSIS_MEASURE = 'mainspring:gantt-analysis';
/** The longest an idle task may wait while the main thread stays busy. */
export const IDLE_TIMEOUT_MS = 200;

/** `requestIdleCallback` with a timeout, or a zero timeout where it is missing (Safari). */
export const whenIdle: Scheduler = (task) => {
	if (typeof requestIdleCallback === 'function') {
		const id = requestIdleCallback(() => task(), { timeout: IDLE_TIMEOUT_MS });
		return () => cancelIdleCallback(id);
	}
	const id = setTimeout(task, 0);
	return () => clearTimeout(id);
};

const cache = new WeakMap<ScheduleResult, DrivingAnalysis | null>();

/** The analysis of a result, computed (and measured) on the first call only. */
export function analysisOf(result: ScheduleResult): DrivingAnalysis | null {
	if (cache.has(result)) return cache.get(result) ?? null;
	const t0 = performance.now();
	const a = analyseResult(result);
	const t1 = performance.now();
	cache.set(result, a);
	try {
		performance.measure(ANALYSIS_MEASURE, {
			start: t0,
			end: t1,
			detail: { tasks: result.tasks.length, revision: result.revision },
		});
	} catch {
		// A runtime without User Timing Level 3 still gets the analysis.
	}
	return a;
}

/**
 * Hands the analysis of `result` to `done`: at once when it is cached, else from an idle task.
 * Returns a function that cancels a pending computation.
 */
export function analyseWhenIdle(
	result: ScheduleResult,
	done: (a: DrivingAnalysis | null) => void,
	schedule: Scheduler = whenIdle,
): () => void {
	if (cache.has(result)) {
		done(cache.get(result) ?? null);
		return () => undefined;
	}
	return schedule(() => done(analysisOf(result)));
}

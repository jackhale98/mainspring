// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The driving-path analysis for the Gantt (phase-2.md 6.2, 8.3) and which result the Gantt draws.
 *
 * The analysis is computed once per engine result, in an idle task, so it never lands in the task
 * that handles a result or paints a frame. `AnalysisGate` publishes the result to draw and its
 * analysis as one pair, so the two never disagree:
 * - with the Critical path chip on, a new result is drawn only once its analysis is ready (an idle
 *   task, at most `IDLE_TIMEOUT_MS` later): until then the previous pair stays, so a reschedule
 *   never makes the critical bars, links and float vanish and come back, and the selected task's
 *   live line does not lose and regain its note;
 * - with the chip off, or before anything is drawn, a new result is drawn at once, and its analysis
 *   follows in an idle task (so turning the chip on later is immediate).
 *
 * A result's analysis is cached by the result object, so a Gantt that mounts again (a mode
 * switch) gets it at once. Each computation is recorded as a `performance` measure named
 * `ANALYSIS_MEASURE`, with the task count, for the timings in the gate (T5). An analysis that
 * throws is cached as null (no highlight for that result) and its error goes to the app's error
 * path (report.ts); the Gantt carries on.
 *
 * The analysis is display data (ADR-0007): it only ever reaches the model's critical and float
 * fields, and never the engine.
 */
import type { ScheduleResult } from '../../engine/protocol';
import { report } from '../report';
import { analyseResult, type DrivingAnalysis } from '../schedule/critical';
import { strings } from '../strings';

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

/** Whether a result's analysis is known (computed, or cached as null after an error). */
export function hasAnalysis(result: ScheduleResult): boolean {
	return cache.has(result);
}

/** The analysis of a result, computed (and measured) on the first call only. */
export function analysisOf(
	result: ScheduleResult,
	onError: (error: unknown) => void = report,
): DrivingAnalysis | null {
	if (cache.has(result)) return cache.get(result) ?? null;
	const t0 = performance.now();
	let a: DrivingAnalysis | null = null;
	try {
		a = analyseResult(result);
	} catch (error) {
		onError(error);
	}
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

/** The result the Gantt draws and its analysis (null while computing, or after an error). */
export interface ShownAnalysis {
	readonly result: ScheduleResult | null;
	readonly analysis: DrivingAnalysis | null;
}

export const NOTHING_SHOWN: ShownAnalysis = { result: null, analysis: null };

export interface GateOptions {
	/** Called with every new pair. */
	publish(shown: ShownAnalysis): void;
	schedule?: Scheduler;
	onError?: (error: unknown) => void;
}

/** Which result the Gantt draws, with its analysis (see the module comment). */
export class AnalysisGate {
	readonly #o: GateOptions;
	#shown: ShownAnalysis = NOTHING_SHOWN;
	#latest: ScheduleResult | null = null;
	#on = true;
	#cancel: (() => void) | null = null;

	constructor(o: GateOptions) {
		this.#o = o;
	}

	get shown(): ShownAnalysis {
		return this.#shown;
	}

	/** The newest good result (null when there is none). */
	offer(result: ScheduleResult | null): void {
		if (result === this.#latest) return;
		this.#latest = result;
		this.#cancel?.();
		this.#cancel = null;
		if (result === null) return this.#set(NOTHING_SHOWN);
		if (hasAnalysis(result)) return this.#set({ result, analysis: analysisOf(result) });
		if (!this.#on || this.#shown.result === null) this.#set({ result, analysis: null });
		this.#cancel = (this.#o.schedule ?? whenIdle)(() => {
			this.#cancel = null;
			if (this.#latest !== result) return;
			this.#set({ result, analysis: analysisOf(result, this.#o.onError) });
		});
	}

	/** The chip turned on or off: off draws the newest result at once. */
	setOn(on: boolean): void {
		this.#on = on;
		const r = this.#latest;
		if (!on && r !== null && this.#shown.result !== r) {
			this.#set({ result: r, analysis: hasAnalysis(r) ? analysisOf(r) : null });
		}
	}

	dispose(): void {
		this.#cancel?.();
		this.#cancel = null;
	}

	#set(shown: ShownAnalysis): void {
		if (shown.result === this.#shown.result && shown.analysis === this.#shown.analysis) return;
		this.#shown = shown;
		this.#o.publish(shown);
	}
}

export interface CriticalChip {
	/** False until the shown result's analysis exists: the chip is then `aria-disabled`. */
	readonly available: boolean;
	readonly pressed: boolean;
	/** What the chip describes: why it is unavailable, or that the values are estimates. */
	readonly why: string;
	/** Shown while the chip is on and nothing is highlighted: the whole path is already done. */
	readonly note: string | null;
}

/** The Critical path chip for the shown pair's analysis and the chip's own state. */
export function chipOf(analysis: DrivingAnalysis | null, on: boolean): CriticalChip {
	const E = strings.gantt.estimate;
	const done = !!analysis && analysis.critical.size === 0 && analysis.path.size > 0;
	return {
		available: analysis !== null,
		pressed: on,
		why: analysis === null ? strings.gantt.criticalUnavailable : E.hint,
		note: on && done ? E.allDone : null,
	};
}

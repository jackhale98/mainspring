// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Page-side instruments for the responsiveness test: a longtask observer, a rAF gap monitor and
 * an Event Timing observer (the API behind INP). Installed with `page.addInitScript` before the
 * page loads, so the `buffered` flag and the first frames are covered.
 *
 * `installMonitor` is serialised into the page: it must not reference anything outside itself.
 */

export interface LongTaskRecord {
	start: number;
	duration: number;
}
export interface FrameGap {
	/** performance.now() of the frame that ended the gap. */
	at: number;
	gapMs: number;
}
/** One Event Timing entry (only events of 16 ms or more are reported by the browser). */
export interface EventRecord {
	name: string;
	startTime: number;
	/** startTime to the next paint, rounded to 8 ms by the browser. */
	duration: number;
	processingStart: number;
}
export interface MonitorData {
	longTasks: LongTaskRecord[];
	frames: FrameGap[];
	events: EventRecord[];
	/** performance.now() of every typed key's `input` event. */
	keys: number[];
}

declare global {
	interface Window {
		__monitor?: MonitorData & {
			/** Resolves after two animation frames; returns performance.now(). */
			twoFrames(): Promise<number>;
		};
	}
}

export function installMonitor(): void {
	const longTasks: LongTaskRecord[] = [];
	const frames: FrameGap[] = [];
	const events: EventRecord[] = [];
	const keys: number[] = [];
	new PerformanceObserver((list) => {
		for (const e of list.getEntries()) longTasks.push({ start: e.startTime, duration: e.duration });
	}).observe({ type: 'longtask', buffered: true });
	new PerformanceObserver((list) => {
		for (const e of list.getEntries() as PerformanceEventTiming[]) {
			events.push({
				name: e.name,
				startTime: e.startTime,
				duration: e.duration,
				processingStart: e.processingStart,
			});
		}
		// durationThreshold is part of Event Timing but missing from TypeScript's DOM types.
	}).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);

	let last = performance.now();
	const frame = (t: number): void => {
		frames.push({ at: t, gapMs: t - last });
		last = t;
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);

	addEventListener('input', () => keys.push(performance.now()), true);

	window.__monitor = {
		longTasks,
		frames,
		events,
		keys,
		twoFrames: () =>
			new Promise((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
			}),
	};
}

export interface WindowStats {
	longTasks: LongTaskRecord[];
	maxFrameGapMs: number;
	/** Longest Event Timing duration; 0 when no event reached the 16 ms threshold. */
	maxEventMs: number;
	/** Longest processingStart - startTime. */
	maxInputDelayMs: number;
	keyCount: number;
}

/** Largest value, or 0 for none (a loop: spreading thousands of frames into Math.max can throw). */
function maxOf(values: Iterable<number>): number {
	let max = 0;
	for (const v of values) if (v > max) max = v;
	return max;
}

/** Statistics of what happened from `start` to `end` (performance.now() values). */
export function windowStats(data: MonitorData, start: number, end: number): WindowStats {
	const events = data.events.filter((e) => e.startTime >= start && e.startTime <= end);
	return {
		longTasks: data.longTasks.filter((t) => t.start < end && t.start + t.duration > start),
		maxFrameGapMs: maxOf(
			data.frames.filter((f) => f.at >= start && f.at <= end).map((f) => f.gapMs),
		),
		maxEventMs: maxOf(events.map((e) => e.duration)),
		maxInputDelayMs: maxOf(events.map((e) => e.processingStart - e.startTime)),
		keyCount: data.keys.filter((k) => k >= start && k <= end).length,
	};
}

/**
 * Long Tasks API entries have whole-millisecond durations (truncated) and coarsened start times,
 * so `start + duration` can fall up to about 1 ms before the true end. A task counts as engine
 * boot only when it ended clearly before the ready mark; anything within ROUNDING_MS of the mark
 * (such as the task that handled the worker's ready message) counts as post-ready, which errs
 * towards failing.
 */
export const ROUNDING_MS = 1;

export function splitByReady(
	tasks: readonly LongTaskRecord[],
	readyAt: number,
): { boot: LongTaskRecord[]; afterReady: LongTaskRecord[] } {
	const boot: LongTaskRecord[] = [];
	const afterReady: LongTaskRecord[] = [];
	for (const t of tasks) (t.start + t.duration + ROUNDING_MS < readyAt ? boot : afterReady).push(t);
	return { boot, afterReady };
}

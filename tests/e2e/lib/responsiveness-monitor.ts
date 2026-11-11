// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Page-side instruments for the responsiveness test: a longtask observer, a rAF gap monitor and
 * an input latency recorder. Installed with `page.addInitScript(installMonitor)` before the page
 * loads, so the observer's `buffered` flag and the first frames are covered.
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
export interface InputRecord {
	/** performance.now() at the handler. */
	at: number;
	/** event.timeStamp to the handler running. */
	handlerMs: number;
	/** event.timeStamp to the next animation frame. */
	frameMs: number;
}
export interface MonitorData {
	longTasks: LongTaskRecord[];
	frames: FrameGap[];
	inputs: InputRecord[];
	now: number;
}

declare global {
	interface Window {
		__monitor?: {
			longTasks: LongTaskRecord[];
			frames: FrameGap[];
			inputs: InputRecord[];
			/** Resolves after two animation frames; returns performance.now(). */
			twoFrames(): Promise<number>;
		};
	}
}

export function installMonitor(): void {
	const longTasks: LongTaskRecord[] = [];
	const frames: FrameGap[] = [];
	const inputs: InputRecord[] = [];
	new PerformanceObserver((list) => {
		for (const e of list.getEntries()) longTasks.push({ start: e.startTime, duration: e.duration });
	}).observe({ type: 'longtask', buffered: true });

	let last = performance.now();
	const frame = (t: number): void => {
		frames.push({ at: t, gapMs: t - last });
		last = t;
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);

	addEventListener(
		'input',
		(e) => {
			const at = performance.now();
			const handlerMs = at - e.timeStamp;
			requestAnimationFrame(() => {
				inputs.push({ at, handlerMs, frameMs: performance.now() - e.timeStamp });
			});
		},
		true,
	);

	window.__monitor = {
		longTasks,
		frames,
		inputs,
		twoFrames: () =>
			new Promise((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
			}),
	};
}

export interface WindowStats {
	longTasks: LongTaskRecord[];
	maxFrameGapMs: number;
	maxInputHandlerMs: number;
	maxInputFrameMs: number;
	inputCount: number;
}

/** Statistics of what happened between `start` and `end` (performance.now() values). */
export function windowStats(data: MonitorData, start: number, end: number): WindowStats {
	const longTasks = data.longTasks.filter((t) => t.start < end && t.start + t.duration > start);
	const gaps = data.frames.filter((f) => f.at >= start && f.at <= end).map((f) => f.gapMs);
	const inputs = data.inputs.filter((i) => i.at >= start && i.at <= end);
	return {
		longTasks,
		maxFrameGapMs: Math.max(0, ...gaps),
		maxInputHandlerMs: Math.max(0, ...inputs.map((i) => i.handlerMs)),
		maxInputFrameMs: Math.max(0, ...inputs.map((i) => i.frameMs)),
		inputCount: inputs.length,
	};
}

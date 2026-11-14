// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The in-page frame meter of /dev/gantt-perf (phase-2.md 8.5, T22): frame intervals from
 * requestAnimationFrame, summarised the way the perf spec and the 18.7 pass definition read them
 * (a frame is on time up to 20 ms, which is 16.7 ms plus 3.3 ms of timestamp jitter; none may take
 * over 50 ms). The summary is a pure function so that it can be tested; `FrameMeter` only
 * collects.
 */

/** A 60 Hz frame is 16.7 ms; 3.3 ms more is allowed for the jitter of rAF timestamps. */
export const ON_TIME_MS = 20;
/** The 18.7 pass definition: no frame over this. */
export const MAX_FRAME_MS = 50;
/** The share of frames that must be on time (18.7). */
export const PASS_ON_TIME_PCT = 95;

export interface FrameSummary {
	frames: number;
	medianMs: number;
	p95Ms: number;
	maxMs: number;
	over50: number;
	onTimePct: number;
	/** 18.7: enough frames on time and none over 50 ms. False when there are no frames. */
	pass: boolean;
}

function percentile(sorted: readonly number[], p: number): number {
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

export function summarise(intervals: readonly number[]): FrameSummary {
	const sorted = [...intervals].sort((a, b) => a - b);
	const frames = sorted.length;
	const onTime = sorted.filter((v) => v <= ON_TIME_MS).length;
	const over50 = sorted.filter((v) => v > MAX_FRAME_MS).length;
	const onTimePct = frames === 0 ? 0 : (100 * onTime) / frames;
	return {
		frames,
		medianMs: percentile(sorted, 50),
		p95Ms: percentile(sorted, 95),
		maxMs: sorted[frames - 1] ?? 0,
		over50,
		onTimePct,
		pass: frames > 0 && onTimePct >= PASS_ON_TIME_PCT && over50 === 0,
	};
}

/** Collects frame intervals while running; the newest `keep` are kept. */
export class FrameMeter {
	#intervals: number[] = [];
	#last = 0;
	#raf = 0;
	#running = false;
	readonly #keep: number;
	readonly #now: () => number;
	readonly #request: (cb: (t: number) => void) => number;
	readonly #cancel: (id: number) => void;

	constructor(
		keep = 3600,
		now: () => number = () => performance.now(),
		request: (cb: (t: number) => void) => number = (cb) => requestAnimationFrame(cb),
		cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
	) {
		this.#keep = keep;
		this.#now = now;
		this.#request = request;
		this.#cancel = cancel;
	}

	get running(): boolean {
		return this.#running;
	}

	start(): void {
		if (this.#running) return;
		this.#running = true;
		this.#last = this.#now();
		const tick = (t: number): void => {
			this.#intervals.push(t - this.#last);
			if (this.#intervals.length > this.#keep) this.#intervals.shift();
			this.#last = t;
			if (this.#running) this.#raf = this.#request(tick);
		};
		this.#raf = this.#request(tick);
	}

	stop(): void {
		this.#running = false;
		this.#cancel(this.#raf);
	}

	reset(): void {
		this.#intervals = [];
	}

	summary(): FrameSummary {
		return summarise(this.#intervals);
	}
}

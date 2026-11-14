// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Frame measurement for the Gantt perf specs (phase-2.md 8.4; T22): the page-side frame meter
 * (rAF intervals and Long Animation Frames, installed before the page loads), a Chromium trace of
 * the same window, and the pure functions that turn both into numbers. The functions take plain
 * arrays so that perf.test.ts can check them without a browser.
 *
 * What each number can say:
 * - rAF intervals show main-thread stalls (a long script or paint task), not what the compositor
 *   presented. `onTimePct` counts intervals up to ON_TIME_MS, which is the 16.7 ms frame of a
 *   60 Hz screen plus 3.3 ms for timestamp jitter (so one missed vsync, 33 ms, is late).
 * - `pipeline.presented` and `pipeline.dropped` count the compositor's PipelineReporter frames in
 *   the trace by state. Headless Chrome has no GPU, so rasterisation is software and the numbers
 *   are an upper bound on cost, not a phone's.
 * - `inputScript` and `rafScript` are the main-thread script times, per frame, of the input
 *   handlers (pointer, mouse and touch moves) and of requestAnimationFrame callbacks.
 */
import type { Page } from '@playwright/test';
import { maxMainThreadTask, traceEventsOf, type TraceEvent } from './trace-max-task';

/** A 60 Hz frame is 16.7 ms; 3.3 ms more is allowed for the jitter of rAF timestamps. */
export const ON_TIME_MS = 20;
/** The pass definition of phase-2.md 18.7: no frame over this. */
export const MAX_FRAME_MS = 50;

export const TRACE_CATEGORIES = [
	'benchmark',
	'cc',
	'viz',
	'disabled-by-default-devtools.timeline.frame',
	'devtools.timeline',
	'toplevel',
];

export interface FrameStats {
	frames: number;
	medianMs: number;
	p95Ms: number;
	maxMs: number;
	over50: number;
	/** Percent of frames whose interval was at most ON_TIME_MS. */
	onTimePct: number;
	loafCount: number;
	loafMaxMs: number;
}

export interface PipelineStats {
	presented: number;
	dropped: number;
	droppedPct: number;
	checkerboardedFrames: number;
}

export interface ScriptStats {
	count: number;
	p50Ms: number;
	p95Ms: number;
	maxMs: number;
}

export interface Measure extends FrameStats {
	pipeline: PipelineStats;
	/** Per frame: the time in input handlers (move events) that ran before that frame's callbacks. */
	inputScript: ScriptStats;
	/** Per frame: the time in requestAnimationFrame callbacks. */
	rafScript: ScriptStats;
	/**
	 * Input latency of the move events (Chromium's `InputLatency::MouseMove` and `TouchMove`): from
	 * the event reaching the browser to the frame that shows its effect. This is the drag feedback
	 * time of phase-2.md 7.3 (budget 16 ms).
	 */
	inputLatency: ScriptStats;
	/** The longest main-thread task (top-level RunTask) in the window. */
	longestTaskMs: number;
	loafBreakdown?: LoafBreakdown;
	scrolledPx?: { x: number; y: number };
}

const round = (v: number): number => Math.round(v * 10) / 10;

export function percentile(values: readonly number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}

export function frameStats(frames: readonly number[], loaf: readonly number[]): FrameStats {
	const on = frames.filter((f) => f <= ON_TIME_MS).length;
	return {
		frames: frames.length,
		medianMs: round(percentile(frames, 50)),
		p95Ms: round(percentile(frames, 95)),
		maxMs: round(Math.max(0, ...frames)),
		over50: frames.filter((f) => f > MAX_FRAME_MS).length,
		onTimePct: frames.length === 0 ? 0 : round((100 * on) / frames.length),
		loafCount: loaf.length,
		loafMaxMs: round(Math.max(0, ...loaf)),
	};
}

type Ev = TraceEvent & { args?: Record<string, unknown> };

/** The compositor's frames in a trace, by state, and how many showed missing tiles. */
export function pipelineOf(trace: unknown): PipelineStats {
	const states = new Map<string, number>();
	let checkerboarded = 0;
	for (const e of traceEventsOf(trace) as Ev[]) {
		if (e.name !== 'PipelineReporter' || e.ph !== 'b') continue;
		const f = e.args?.['frame_reporter'] as Record<string, unknown> | undefined;
		if (!f) continue;
		const state = String(f['state']);
		states.set(state, (states.get(state) ?? 0) + 1);
		if (
			f['checkerboarded_needs_raster'] ||
			f['checkerboarded_needs_record'] ||
			f['has_missing_content']
		)
			checkerboarded++;
	}
	const get = (s: string): number => states.get(s) ?? 0;
	const presented = get('STATE_PRESENTED_ALL') + get('STATE_PRESENTED_PARTIAL');
	const dropped = get('STATE_DROPPED');
	return {
		presented,
		dropped,
		droppedPct: presented + dropped === 0 ? 0 : round((100 * dropped) / (presented + dropped)),
		checkerboardedFrames: checkerboarded,
	};
}

const INPUT_MOVES: ReadonlySet<string> = new Set(['pointermove', 'mousemove', 'touchmove']);

/**
 * Script time per frame, from `EventDispatch` (input) and `FireAnimationFrame` events on the page's
 * main thread. A frame is one FireAnimationFrame; the input events before it (since the one
 * before) belong to it, which is how the work between two frames lands in the frame that paints it.
 */
export function scriptTimes(trace: unknown): { input: ScriptStats; raf: ScriptStats } {
	const events = traceEventsOf(trace) as Ev[];
	const main = new Set<string>();
	for (const e of events) {
		if (e.ph === 'M' && e.name === 'thread_name' && e.args?.['name'] === 'CrRendererMain')
			main.add(`${e.pid}:${e.tid}`);
	}
	const busiest = new Map<string, number>();
	for (const e of events) {
		if (e.ph !== 'X' || e.name !== 'FireAnimationFrame') continue;
		const k = `${e.pid}:${e.tid}`;
		if (main.has(k)) busiest.set(k, (busiest.get(k) ?? 0) + 1);
	}
	let thread = '';
	let most = -1;
	for (const [k, n] of busiest) {
		if (n > most) {
			thread = k;
			most = n;
		}
	}
	const mine = events.filter((e) => `${e.pid}:${e.tid}` === thread && e.ph === 'X');
	const raf = mine
		.filter((e) => e.name === 'FireAnimationFrame' && e.ts !== undefined)
		.sort((a, b) => (a.ts as number) - (b.ts as number));
	const input = mine.filter((e) => {
		const data = e.args?.['data'] as { type?: string } | undefined;
		return e.name === 'EventDispatch' && e.ts !== undefined && INPUT_MOVES.has(data?.type ?? '');
	});
	const perFrameInput = new Array<number>(raf.length).fill(0);
	for (const e of input) {
		// The first frame that starts at or after the event.
		let lo = 0;
		let hi = raf.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((raf[mid]?.ts as number) < (e.ts as number)) lo = mid + 1;
			else hi = mid;
		}
		if (lo < raf.length) perFrameInput[lo] = (perFrameInput[lo] ?? 0) + (e.dur ?? 0) / 1000;
	}
	const stats = (v: number[]): ScriptStats => ({
		count: v.length,
		p50Ms: round(percentile(v, 50)),
		p95Ms: round(percentile(v, 95)),
		maxMs: round(Math.max(0, ...v)),
	});
	return {
		input: stats(perFrameInput),
		raf: stats(raf.map((e) => (e.dur ?? 0) / 1000)),
	};
}

type Async = Ev & { id?: string; id2?: { local?: string; global?: string } };

/** Durations of the move events' latency spans (async begin and end pairs), in ms. */
export function inputLatency(trace: unknown): ScriptStats {
	const open = new Map<string, number>();
	const durs: number[] = [];
	for (const e of traceEventsOf(trace) as Async[]) {
		if (!e.name || !/^InputLatency::(Mouse|Touch|Pointer)Move$/.test(e.name)) continue;
		const id = e.id ?? e.id2?.local ?? e.id2?.global ?? '';
		const key = `${e.name}:${id}`;
		if (e.ph === 'b' && e.ts !== undefined) open.set(key, e.ts);
		else if (e.ph === 'e' && e.ts !== undefined && open.has(key)) {
			durs.push((e.ts - (open.get(key) as number)) / 1000);
			open.delete(key);
		}
	}
	return {
		count: durs.length,
		p50Ms: round(percentile(durs, 50)),
		p95Ms: round(percentile(durs, 95)),
		maxMs: round(Math.max(0, ...durs)),
	};
}

export function measureOf(
	frames: readonly number[],
	loaf: readonly number[],
	trace: unknown,
): Measure {
	const s = scriptTimes(trace);
	return {
		...frameStats(frames, loaf),
		pipeline: pipelineOf(trace),
		inputScript: s.input,
		rafScript: s.raf,
		inputLatency: inputLatency(trace),
		longestTaskMs: round(maxMainThreadTask(trace).maxMs),
	};
}

type LoafPart = { script: number; render: number; styleLayout: number; blocking: number };
type ProbeWin = {
	__frames: number[];
	__loaf: number[];
	__loafParts: LoafPart[];
	__recording: boolean;
};

/**
 * Where the long animation frames' time went, summed (ms): script (the entries' `scripts`), render
 * (from `renderStart` to the end: style, layout, paint, the work before the compositor) and, within
 * it, style and layout. A long frame whose time is mostly render is paint or layout, not our script.
 */
export interface LoafBreakdown {
	count: number;
	scriptMs: number;
	renderMs: number;
	styleLayoutMs: number;
	blockingMs: number;
}

/** Installs the frame meter and the LoAF observer for the page's whole life (before it loads). */
export async function installProbe(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const w = window as unknown as ProbeWin;
		w.__recording = false;
		w.__frames = [];
		w.__loaf = [];
		w.__loafParts = [];
		let last = performance.now();
		const tick = (t: number): void => {
			if (w.__recording) w.__frames.push(t - last);
			last = t;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		try {
			new PerformanceObserver((list) => {
				if (!w.__recording) return;
				for (const e of list.getEntries()) {
					w.__loaf.push(e.duration);
					const f = e as PerformanceEntry & {
						renderStart: number;
						styleAndLayoutStart: number;
						blockingDuration: number;
						scripts: Array<{ duration: number }>;
					};
					const end = e.startTime + e.duration;
					w.__loafParts.push({
						script: f.scripts.reduce((a, x) => a + x.duration, 0),
						render: f.renderStart ? end - f.renderStart : 0,
						styleLayout: f.styleAndLayoutStart ? end - f.styleAndLayoutStart : 0,
						blocking: f.blockingDuration,
					});
				}
			}).observe({ type: 'long-animation-frame', buffered: false });
		} catch {
			// Not supported: the count stays 0.
		}
	});
}

/** Runs `run` with the meter and a trace on, and returns the numbers of that window. */
export async function measure(page: Page, run: () => Promise<void>): Promise<Measure> {
	const browser = page.context().browser();
	if (!browser) throw new Error('measure needs a browser handle for tracing');
	await page.evaluate(() => {
		const w = window as unknown as ProbeWin;
		w.__frames = [];
		w.__loaf = [];
		w.__loafParts = [];
		w.__recording = true;
	});
	await browser.startTracing(page, { categories: TRACE_CATEGORIES });
	let raw: Buffer;
	let frames: number[] = [];
	let loaf: number[] = [];
	let parts: LoafPart[] = [];
	try {
		await run();
		// The window ends with the run: the idle frames of the wait below must not flatter the result.
		({ frames, loaf, parts } = await page.evaluate(() => {
			const w = window as unknown as ProbeWin;
			w.__recording = false;
			return { frames: w.__frames.slice(1), loaf: w.__loaf, parts: w.__loafParts };
		}));
		await page.waitForTimeout(300);
	} finally {
		raw = await browser.stopTracing();
	}
	const m = measureOf(frames, loaf, JSON.parse(raw.toString()) as unknown);
	const sum = (k: keyof LoafPart): number => Math.round(parts.reduce((a, x) => a + x[k], 0));
	m.loafBreakdown = {
		count: parts.length,
		scriptMs: sum('script'),
		renderMs: sum('render'),
		styleLayoutMs: sum('styleLayout'),
		blockingMs: sum('blocking'),
	};
	return m;
}

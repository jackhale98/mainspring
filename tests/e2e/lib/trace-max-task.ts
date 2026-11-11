// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Finds the longest top-level task on a renderer main thread in a Chromium trace
 * (`browser.startTracing` with the `devtools.timeline` category).
 *
 * Top-level tasks are the `RunTask` events (Chromium also names them
 * `ThreadControllerImpl::RunTask` in the `toplevel` category) on the thread named
 * `CrRendererMain`. With several renderer processes in the trace, the one with the most events
 * on its main thread is the page under test.
 */

export interface TraceEvent {
	name?: string;
	ph?: string;
	pid?: number;
	tid?: number;
	ts?: number;
	/** Microseconds. */
	dur?: number;
	/** Thread CPU time in microseconds. */
	tdur?: number;
	args?: { name?: string };
}

export interface MaxTask {
	/** Wall-clock milliseconds of the longest task; 0 when the trace holds no task. */
	maxMs: number;
	/**
	 * The longest thread CPU time (`tdur`) of any task, in milliseconds; null when no task carries
	 * `tdur` (callers must treat that as a failure, not as 0). A task far longer in wall time than
	 * in CPU time was blocked, not busy.
	 */
	maxCpuMs: number | null;
	/** Thread CPU time of the longest task by wall time; null when it has no `tdur`. */
	longestCpuMs: number | null;
	taskCount: number;
	pid: number | null;
	tid: number | null;
	/** Trace timestamp (microseconds) of the longest task. */
	startUs: number | null;
}

const TASK_NAMES: ReadonlySet<string> = new Set(['RunTask', 'ThreadControllerImpl::RunTask']);

/** Accepts the parsed trace: either `{ traceEvents: [...] }` or a bare array. */
export function traceEventsOf(trace: unknown): TraceEvent[] {
	if (Array.isArray(trace)) return trace as TraceEvent[];
	const events = (trace as { traceEvents?: unknown } | null)?.traceEvents;
	if (!Array.isArray(events)) throw new Error('not a Chromium trace: no traceEvents array');
	return events as TraceEvent[];
}

/** @param since optional trace timestamp (microseconds); only tasks starting at or after it count. */
export function maxMainThreadTask(trace: unknown, since = 0): MaxTask {
	const events = traceEventsOf(trace);
	const mainThreads = new Set<string>();
	for (const e of events) {
		if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain') {
			mainThreads.add(`${e.pid}:${e.tid}`);
		}
	}
	const byThread = new Map<string, TraceEvent[]>();
	for (const e of events) {
		if (e.ph !== 'X' || !e.name || !TASK_NAMES.has(e.name)) continue;
		if (e.dur === undefined || e.ts === undefined || e.ts < since) continue;
		const key = `${e.pid}:${e.tid}`;
		if (!mainThreads.has(key)) continue;
		const list = byThread.get(key) ?? [];
		list.push(e);
		byThread.set(key, list);
	}
	let busiest: TraceEvent[] | null = null;
	for (const list of byThread.values()) {
		if (!busiest || list.length > busiest.length) busiest = list;
	}
	if (!busiest)
		return {
			maxMs: 0,
			maxCpuMs: null,
			longestCpuMs: null,
			taskCount: 0,
			pid: null,
			tid: null,
			startUs: null,
		};
	let longest = busiest[0] as TraceEvent;
	for (const e of busiest) if ((e.dur ?? 0) > (longest.dur ?? 0)) longest = e;
	let maxCpuUs: number | null = null;
	for (const e of busiest) {
		if (e.tdur !== undefined && (maxCpuUs === null || e.tdur > maxCpuUs)) maxCpuUs = e.tdur;
	}
	return {
		maxMs: (longest.dur ?? 0) / 1000,
		maxCpuMs: maxCpuUs === null ? null : maxCpuUs / 1000,
		longestCpuMs: longest.tdur === undefined ? null : longest.tdur / 1000,
		taskCount: busiest.length,
		pid: longest.pid ?? null,
		tid: longest.tid ?? null,
		startUs: longest.ts ?? null,
	};
}

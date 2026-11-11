// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { maxMainThreadTask, traceEventsOf, type TraceEvent } from './trace-max-task';

const main = (pid: number, tid: number): TraceEvent => ({
	ph: 'M',
	name: 'thread_name',
	pid,
	tid,
	args: { name: 'CrRendererMain' },
});
const task = (
	pid: number,
	tid: number,
	ts: number,
	dur: number,
	tdur?: number,
	name = 'RunTask',
): TraceEvent => ({
	ph: 'X',
	name,
	pid,
	tid,
	ts,
	dur,
	...(tdur === undefined ? {} : { tdur }),
});

describe('maxMainThreadTask', () => {
	it('finds the longest task on the main thread, in ms', () => {
		const r = maxMainThreadTask({
			traceEvents: [main(1, 1), task(1, 1, 0, 2000, 1500), task(1, 1, 5000, 30000, 4000)],
		});
		expect(r).toMatchObject({
			maxMs: 30,
			maxCpuMs: 4,
			longestCpuMs: 4,
			taskCount: 2,
			startUs: 5000,
		});
	});

	it('ignores other threads, even longer ones, and non-task events', () => {
		const r = maxMainThreadTask([
			main(1, 1),
			task(1, 1, 0, 1000, 900),
			task(1, 2, 0, 900000, 900000),
			{ ph: 'X', name: 'FunctionCall', pid: 1, tid: 1, ts: 0, dur: 800000 },
			{ ph: 'B', name: 'RunTask', pid: 1, tid: 1, ts: 0 },
		]);
		expect(r.maxMs).toBe(1);
	});

	it('accepts the ThreadControllerImpl::RunTask name', () => {
		const r = maxMainThreadTask([
			main(1, 1),
			task(1, 1, 0, 7000, 100, 'ThreadControllerImpl::RunTask'),
		]);
		expect(r.maxMs).toBe(7);
	});

	it('picks the renderer main thread with the most tasks', () => {
		const r = maxMainThreadTask([
			main(1, 1),
			main(2, 5),
			task(1, 1, 0, 99000),
			task(2, 5, 0, 1000),
			task(2, 5, 2000, 2000),
			task(2, 5, 5000, 3000),
		]);
		expect(r).toMatchObject({ pid: 2, tid: 5, taskCount: 3, maxMs: 3 });
	});

	it('counts only tasks starting at or after `since`', () => {
		const events = [main(1, 1), task(1, 1, 100, 40000), task(1, 1, 200, 5000)];
		expect(maxMainThreadTask(events, 200).maxMs).toBe(5);
		expect(maxMainThreadTask(events, 0).maxMs).toBe(40);
	});

	it('reports a missing tdur as null, never as 0', () => {
		const r = maxMainThreadTask([main(1, 1), task(1, 1, 0, 9000)]);
		expect(r.maxCpuMs).toBeNull();
		expect(r.longestCpuMs).toBeNull();
		const mixed = maxMainThreadTask([
			main(1, 1),
			task(1, 1, 0, 9000),
			task(1, 1, 10000, 2000, 1000),
		]);
		expect(mixed.maxCpuMs).toBe(1);
		expect(mixed.longestCpuMs).toBeNull();
	});

	it('returns zeros for a trace without main-thread tasks', () => {
		expect(maxMainThreadTask([])).toMatchObject({ maxMs: 0, taskCount: 0, pid: null });
	});

	it('rejects input that is not a trace', () => {
		expect(() => traceEventsOf({})).toThrow(/traceEvents/);
		expect(() => traceEventsOf(null)).toThrow(/traceEvents/);
	});
});

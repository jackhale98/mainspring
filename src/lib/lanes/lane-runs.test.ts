// SPDX-License-Identifier: GPL-2.0-or-later
// The runs a lane draws (phase-3.md 9.4): a task's bookings merged per task per day, bridged
// across non-working gaps only, never over another task's time or a day of leave; leave blocks
// joined over non-working gaps. Frame: Monday 2026-01-05, Mon-Fri 09:00-17:00 (schedule/testing.ts).
import { describe, expect, it } from 'vitest';
import { at, weekdays } from '../schedule/testing';
import { mergePairs, totalMinutes } from '../workload/intervals';
import type { IntervalSet } from '../workload/types';
import { bridge, dayIndex, laneRuns, leaveRuns } from './lane-runs';

const days = Int32Array.from({ length: 57 }, (_, i) => i * 1440);
const working = weekdays(56);
const day = (d: number, from: number, to: number): [number, number] => [at(d, from), at(d, to)];
const week = (task: string, ds: number[]) => ({
	task,
	intervals: ds.map((d) => day(d, 9, 17)),
});

describe('dayIndex', () => {
	it('finds the day that holds a minute', () => {
		expect(dayIndex(days, 0)).toBe(0);
		expect(dayIndex(days, 1439)).toBe(0);
		expect(dayIndex(days, 1440)).toBe(1);
		expect(dayIndex(days, at(55, 12))).toBe(55);
	});
	it('is 0 for an axis without days', () => {
		expect(dayIndex(Int32Array.of(0), 100)).toBe(0);
	});
});

describe('bridge', () => {
	it('joins a pair to the one before when the gap may go', () => {
		expect(
			bridge(
				[
					[0, 10],
					[20, 30],
					[40, 50],
				],
				(a, b) => b - a <= 10,
			),
		).toEqual([[0, 50]]);
		expect(
			bridge(
				[
					[0, 10],
					[25, 30],
					[40, 50],
				],
				(a, b) => b - a <= 10,
			),
		).toEqual([
			[0, 10],
			[25, 50],
		]);
	});
	it('keeps an empty set empty', () => {
		expect(bridge([], () => true)).toEqual([]);
	});
});

describe('laneRuns', () => {
	const run = (tasks: ReturnType<typeof week>[], hours: IntervalSet = working) => {
		const booked = mergePairs(tasks.flatMap((t) => t.intervals));
		return laneRuns(tasks, booked, hours, days);
	};

	it('joins a task that works Monday to Friday into one bar, over the nights', () => {
		const r = run([week('a', [0, 1, 2, 3, 4])]);
		expect(r).toEqual([{ task: 'a', from: at(0, 9), to: at(4, 17), minutes: 5 * 480 }]);
	});

	it('joins over a weekend, which holds no working time', () => {
		const r = run([week('a', [3, 4, 7, 8])]);
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ from: at(3, 9), to: at(8, 17), minutes: 4 * 480 });
	});

	it('splits at a free working day: the person could have worked, and did not', () => {
		const r = run([week('a', [0, 1, 3, 4])]);
		expect(r.map((x) => [x.from, x.to])).toEqual([
			[at(0, 9), at(1, 17)],
			[at(3, 9), at(4, 17)],
		]);
	});

	it('merges a task per day over a break inside the day', () => {
		const r = run([{ task: 'a', intervals: [day(0, 9, 12), day(0, 13, 17)] }]);
		expect(r).toEqual([{ task: 'a', from: at(0, 9), to: at(0, 17), minutes: 7 * 60 }]);
	});

	it('does not merge over another task booked in the gap (no stacking)', () => {
		const a = { task: 'a', intervals: [day(0, 9, 11), day(0, 12, 17)] };
		const b = { task: 'b', intervals: [day(0, 11, 12)] };
		const r = run([a, b]);
		expect(r.map((x) => [x.task, x.from, x.to])).toEqual([
			['a', at(0, 9), at(0, 11)],
			['b', at(0, 11), at(0, 12)],
			['a', at(0, 12), at(0, 17)],
		]);
		// No two bars overlap.
		for (let i = 1; i < r.length; i++)
			expect((r[i] as { from: number }).from).toBeGreaterThanOrEqual(
				(r[i - 1] as { to: number }).to,
			);
	});

	it('does not bridge a day of leave: the hatch stays visible between the bars', () => {
		const leave: IntervalSet = [day(1, 9, 17)];
		const hours = mergePairs([...working.filter(([s]) => s !== at(1, 9)), ...leave]);
		const r = run([week('a', [0, 2])], hours);
		expect(r.map((x) => [x.from, x.to])).toEqual([
			[at(0, 9), at(0, 17)],
			[at(2, 9), at(2, 17)],
		]);
	});

	it('orders the bars of several tasks by start, and conserves the booked minutes', () => {
		const tasks = [week('b', [2, 3]), week('a', [0, 1]), week('c', [4])];
		const r = run(tasks);
		expect(r.map((x) => x.task)).toEqual(['a', 'b', 'c']);
		expect(r.reduce((n, x) => n + x.minutes, 0)).toBe(
			totalMinutes(mergePairs(tasks.flatMap((t) => t.intervals))),
		);
	});

	it('has no bars for no bookings', () => {
		expect(run([])).toEqual([]);
	});
});

describe('leaveRuns', () => {
	it('joins a week of leave (one slot per working day) into one block', () => {
		const leave = [0, 1, 2, 3, 4].map((d) => day(d, 9, 17));
		expect(
			leaveRuns(
				leave,
				working.filter(([s]) => s >= at(5, 0)),
			),
		).toEqual([{ from: at(0, 9), to: at(4, 17) }]);
	});
	it('splits where the person had working time between two leaves', () => {
		const leave = [day(0, 9, 17), day(2, 9, 17)];
		expect(leaveRuns(leave, working)).toEqual([
			{ from: at(0, 9), to: at(0, 17) },
			{ from: at(2, 9), to: at(2, 17) },
		]);
	});
});

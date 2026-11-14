// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	clampDays,
	ghostForMove,
	ghostForProgress,
	ghostForResize,
	moveRef,
	resizeRef,
	type MoveEnv,
} from './preview';
import { at, row, testWorkingTime } from './testing';

const wt = testWorkingTime();
// Tue 9:00 to Thu 17:00: three working days.
const task = row(0, at(1), at(3, 17));
const env = (over: Partial<MoveEnv> = {}): MoveEnv => ({
	wt,
	row: task,
	alap: false,
	floor: null,
	ceiling: null,
	...over,
});

describe('moves', () => {
	it('shifts an ASAP task by working days and keeps its working length across a weekend', () => {
		// +3 working days: Tue becomes Fri, and three working days from there end the next Tue.
		const g = ghostForMove(env(), 3, 0);
		expect(g.start).toBe(at(4));
		expect(g.end).toBe(at(8, 17));
		expect(g.state).toBe('preview');
	});

	it('holds an ALAP task at its end', () => {
		// Thursday's end plus two working days is Monday's; three working days back from there.
		const g = ghostForMove(env({ alap: true }), 2, 0);
		expect(g.end).toBe(at(7, 17));
		expect(g.start).toBe(at(3, 9));
	});

	it('is the task as it is for zero days', () => {
		const g = ghostForMove(env(), 0, 0);
		expect([g.start, g.end]).toEqual([task.start, task.end]);
	});

	it('moves back before the start, by working days', () => {
		expect(ghostForMove(env(), -1, 0).start).toBe(at(0));
	});

	it('translates when there is no working time', () => {
		const g = ghostForMove(env({ wt: null }), 2, 0);
		expect(g.start - (task.start ?? 0)).toBe(2 * 1440);
		expect(g.end - (task.end ?? 0)).toBe(2 * 1440);
	});
});

describe('the clamp', () => {
	it('stops an ASAP task at the earliest start its dependencies allow', () => {
		// A Thursday start with a Tuesday floor can go back two days, not three.
		const thu = env({ row: row(0, at(3), at(4, 17)), floor: at(1) });
		expect(clampDays(thu, -1)).toBe(-1);
		expect(clampDays(thu, -2)).toBe(-2);
		expect(clampDays(thu, -3)).toBe(-2);
		expect(clampDays(env({ floor: at(1) }), -2)).toBe(0);
	});

	it('leaves a move the other way, and a task with no limit, alone', () => {
		expect(clampDays(env({ floor: at(1) }), 4)).toBe(4);
		expect(clampDays(env(), -1)).toBe(-1);
	});

	it('stops an ALAP task at the latest end its dependents allow', () => {
		// The end is Thursday 17:00; Friday's is one day on, the limit.
		expect(clampDays(env({ alap: true, ceiling: at(4, 17) }), 5)).toBe(1);
		expect(clampDays(env({ alap: true, ceiling: at(4, 17) }), -2)).toBe(-2);
	});
});

describe('resizes', () => {
	it('moves the end of an ASAP task and keeps the start', () => {
		const g = ghostForResize(wt, task, false, at(5 + 0, 17), 3);
		expect([g.row, g.start, g.end]).toEqual([3, at(1), at(5, 17)]);
	});

	it('is never shorter than a working day', () => {
		const g = ghostForResize(wt, task, false, at(0, 17), 0);
		expect(g.end).toBe(at(1, 17));
	});

	it('moves the start of an ALAP task and keeps the end', () => {
		const g = ghostForResize(wt, task, true, at(0), 0);
		expect([g.start, g.end]).toEqual([at(0), at(3, 17)]);
		expect(ghostForResize(wt, task, true, at(4), 0).start).toBe(at(3));
	});

	it('measures a resize from the snapped edge', () => {
		expect(resizeRef(wt, task, false)).toBe(at(3, 17));
		expect(resizeRef(wt, task, true)).toBe(at(1));
		expect(moveRef(wt, row(0, at(1, 3), at(2)))).toBe(at(1));
	});
});

describe('progress', () => {
	it('keeps the bar and changes the share done', () => {
		const g = ghostForProgress(task, 40, 2);
		expect([g.row, g.start, g.end, g.complete]).toEqual([2, task.start, task.end, 40]);
	});
});

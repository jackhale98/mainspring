// SPDX-License-Identifier: GPL-2.0-or-later
// The lanes' model (phase-3.md 9.4): bars and leave per person from the engine's intervals, which
// tasks a drag may start from, the leave types, the bar under a point, and the words for each
// period (the ARIA mirror). The plan is rebalance-testing.ts's inline one (Ann, Bo in Team, Cy),
// with leave added for Cy.
import { describe, expect, it } from 'vitest';
import { at } from '../schedule/testing';
import { DEFAULT_THRESHOLDS } from '../workload/types';
import { barAt, type LaneBar } from './lane-model';
import { laneCellTasks } from './lane-text';
import { lanesOf, macroText, rowOf } from './testing';

describe('LanesModel', () => {
	const lanes = lanesOf();

	it('has the heatmap rows: a group above its members', () => {
		expect(lanes.load.rows.map((r) => [r.id, r.group])).toEqual([
			['a', false],
			['team', true],
			['b', false],
			['c', false],
		]);
	});

	it("draws a person's bars by start, one per task, merged over the nights", () => {
		const runs = lanes.runs(rowOf(lanes, 'a'));
		expect(runs.map((r) => [r.task, r.from, r.to, r.minutes])).toEqual([
			['parent.child', at(0, 9), at(1, 17), 960],
			['pair', at(2, 9), at(3, 17), 960],
		]);
	});

	it('has no bars for a group, and none for a person with no bookings', () => {
		expect(lanes.runs(rowOf(lanes, 'team'))).toEqual([]);
		expect(lanes.runs(rowOf(lanes, 'b'))).toEqual([]);
		expect(lanes.runs(99)).toEqual([]);
	});

	it('keeps the runs made (the same array on the next ask)', () => {
		const row = rowOf(lanes, 'a');
		expect(lanes.runs(row)).toBe(lanes.runs(row));
	});

	it('lets a drag start from a task the text declares, and from no other', () => {
		for (const r of lanes.runs(rowOf(lanes, 'c'))) {
			expect(r.movable).toBe(true);
			expect(r.textOnly).toBe(false);
		}
	});

	it('shows leave as one block by type, over the two working days it takes', () => {
		const leaves = lanes.leaves(rowOf(lanes, 'c'));
		expect(leaves).toEqual([{ type: 'annual', runs: [{ from: at(14, 9), to: at(15, 17) }] }]);
		expect(lanes.leaves(rowOf(lanes, 'a'))).toEqual([]);
		expect(lanes.leaveTypes()).toEqual(['annual']);
	});

	it("says each period's tasks in words (names from the result: the test plan names tasks by id), with hours, for a person and not for a group", () => {
		const a = rowOf(lanes, 'a');
		expect(laneCellTasks(lanes, a, 0)).toBe('works on pair 16 h, parent.child 16 h');
		expect(laneCellTasks(lanes, rowOf(lanes, 'b'), 0)).toBe('');
		expect(laneCellTasks(lanes, rowOf(lanes, 'team'), 0)).toBe('');
	});

	it('marks the bars of a task the editor cannot move: a badge, no drag', () => {
		const { text, line } = macroText();
		const l = lanesOf(text, 'week', { task: 'late', line });
		const late = l.runs(rowOf(l, 'c')).find((r) => r.task === 'late');
		expect(late).toMatchObject({ movable: false, textOnly: true });
		expect(l.isTextOnly('late')).toBe(true);
		expect(laneCellTasks(l, rowOf(l, 'c'), 1)).toContain('late 16 h (text only)');
	});

	it('shows the heatmap band of a period (the shared rule at the lanes zoom)', () => {
		const m = lanes.load;
		const a = rowOf(lanes, 'a');
		// Ann works 32 of 40 hours in week 0: 80 %, full, not over.
		expect(m.band(a, 0, DEFAULT_THRESHOLDS)).toBe('full');
	});
});

describe('barAt', () => {
	const bar = (from: number, to: number): LaneBar => ({
		task: `t${from}`,
		from,
		to,
		minutes: to - from,
		movable: true,
		textOnly: false,
	});
	const runs = [bar(0, 100), bar(100, 200), bar(500, 502), bar(900, 1000)];
	const xOf = (m: number): number => m / 10;

	it('finds the bar that holds the point, and the right one at a shared edge', () => {
		expect(barAt(runs, xOf, 5, 4, 0)?.task).toBe('t0');
		expect(barAt(runs, xOf, 15, 4, 0)?.task).toBe('t100');
		expect(barAt(runs, xOf, 95, 4, 0)?.task).toBe('t900');
	});

	it('finds nothing in the gaps, but a few pixels of slop reach the nearest bar', () => {
		expect(barAt(runs, xOf, 30, 4, 0)).toBeNull();
		expect(barAt(runs, xOf, 48, 4, 3)?.task).toBe('t500');
		expect(barAt(runs, xOf, 40, 4, 3)).toBeNull();
	});

	it('hits a bar narrower than the minimum width over the minimum', () => {
		// 500 to 502 minutes is 0.2 px; kept at 4 px.
		expect(barAt(runs, xOf, 53, 4, 0)?.task).toBe('t500');
		expect(barAt(runs, xOf, 55, 4, 0)).toBeNull();
	});

	it('is null on no bars', () => {
		expect(barAt([], xOf, 10, 4, 4)).toBeNull();
	});
});

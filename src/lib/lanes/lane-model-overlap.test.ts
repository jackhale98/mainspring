// SPDX-License-Identifier: GPL-2.0-or-later
// The lanes over overlapping global leaves (fixture overlapping-global-leaves, phase-3.md 9.4, 21):
// Easter (holiday, 3 to 7 April 2026) and Overlap (special, 6 to 8 April) share Monday 6 April. The
// engine marks that day off hours for Ada (in neither her working time nor her leave), and the lane
// draws it as a holiday block. Her effort runs across it: a bar must not join across the block, and
// none may be painted over it.
import { describe, expect, it } from 'vitest';
import { at, weekdays } from '../schedule/testing';
import { availabilityOf } from '../workload/availability';
import { buildLoad } from '../workload/load';
import { INLINE_TEXT, inlinePlan, planFrom, workloadPlan } from '../workload/rebalance-testing';
import { booking, resourceResult, withPeople } from '../workload/testing';
import { buildLanes } from './lane-model';
import { ZONES, rowOf, slots } from './testing';

const DAY = 1440;

function lanes() {
	const p = workloadPlan('overlapping-global-leaves');
	const project = p.result.project;
	if (!project) throw new Error('no project');
	const availability = availabilityOf(p.result, 'plan');
	const load = buildLoad({
		result: p.result,
		index: p.index,
		zones: ZONES,
		kind: 'week',
		collapsed: new Set(),
		availability,
		demand: null,
	});
	return buildLanes({
		load,
		availability,
		result: p.result,
		project,
		index: p.index,
		zones: ZONES,
	});
}

describe('LanesModel over overlapping global leaves', () => {
	const l = lanes();
	const ada = rowOf(l, 'ada');
	// Monday 2026-04-06: the project starts Monday 2026-03-30, so it is day 7.
	const lost = [7 * DAY, 8 * DAY] as const;

	it('draws the lost day inside a holiday block', () => {
		// Easter's own Friday is a holiday block too: look through all the holiday blocks.
		const holiday = l.leaves(ada).filter((x) => x.type === 'holiday');
		const covers = holiday
			.flatMap((h) => h.runs)
			.some((r) => r.from <= lost[0] + 9 * 60 && r.to >= lost[0] + 17 * 60);
		expect(covers).toBe(true);
		expect(l.leaveTypes()).toContain('holiday');
	});

	it('does not run a bar across it, nor lay one over the block', () => {
		const bars = l.runs(ada);
		expect(bars.length).toBeGreaterThan(1);
		for (const b of bars) expect(b.from >= lost[1] || b.to <= lost[0]).toBe(true);
		const before = bars.filter((b) => b.to <= lost[0]).at(-1);
		const after = bars.find((b) => b.from >= lost[1]);
		if (!before || !after) throw new Error('the effort does not run on both sides of the day');
		// What the run lost is a whole working day between the two bars.
		expect(after.from - before.to).toBeGreaterThanOrEqual(DAY);
		// And it is the same task: it would have been one bar without the block.
		expect(after.task).toBe(before.task);
	});
});

describe('a bar over a day lost to overlapping leaves, with nothing else in the gap', () => {
	// Ann books Monday and Wednesday of one task. Tuesday is under two global leaves, so the engine
	// has it in neither her working time nor her leave: only the lost-day rule keeps the bar from
	// joining across it (the day is not Ann's free time, it is hatched as a holiday).
	it('splits the bar at the lost day', () => {
		const base = inlinePlan().result;
		const project = base.project;
		if (!project) throw new Error('no project');
		const leaf = (type: 'holiday' | 'special') => ({
			type,
			name: null,
			interval: [DAY, 2 * DAY] as [number, number],
		});
		const withLeaves = { ...project, leaves: [leaf('holiday'), leaf('special')] };
		const result = withPeople(
			{ ...base, project: withLeaves },
			[
				resourceResult('a', {
					workingTime: weekdays(56).filter(([s]) => s !== DAY + 9 * 60),
				}),
			],
			[booking('a', 'pair', slots([0, 2]))],
		);
		const p = planFrom({ 'plan.tjp': INLINE_TEXT }, 'plan.tjp', result);
		const availability = availabilityOf(result, 'plan');
		const load = buildLoad({
			result,
			index: p.index,
			zones: ZONES,
			kind: 'week',
			collapsed: new Set(),
			availability,
			demand: null,
		});
		const l = buildLanes({
			load,
			availability,
			result,
			project: withLeaves,
			index: p.index,
			zones: ZONES,
		});
		const bars = l.runs(rowOf(l, 'a'));
		expect(bars.map((b) => [b.from, b.to])).toEqual([
			[at(0, 9), at(0, 17)],
			[at(2, 9), at(2, 17)],
		]);
		expect(l.leaves(rowOf(l, 'a'))).toEqual([
			{ type: 'holiday', runs: [{ from: at(1, 9), to: at(1, 17) }] },
		]);
	});
});

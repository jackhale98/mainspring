// SPDX-License-Identifier: GPL-2.0-or-later
// What a lane period says in words (lane-text.ts, phase-3.md 10): the tasks booked in it with their
// hours, "text only" where the editor cannot move them, "and N more" past the cap, and nothing for
// a group's roll-up, a person with nothing booked, or a period outside the plan.
import { describe, expect, it } from 'vitest';
import type { CellTask } from '../workload/types';
import type { LanesModel } from './lane-model';
import { MAX_NAMED, laneCellTasks } from './lane-text';
import { lanesOf, macroText, rowOf } from './testing';

describe('laneCellTasks on a lanes model', () => {
	const l = lanesOf();

	it('names the booked tasks of a person with their hours, most hours first', () => {
		expect(laneCellTasks(l, rowOf(l, 'a'), 0)).toBe('works on pair 16 h, parent.child 16 h');
	});

	it('says nothing for a person with nothing booked in the period', () => {
		expect(laneCellTasks(l, rowOf(l, 'b'), 0)).toBe('');
		expect(laneCellTasks(l, rowOf(l, 'a'), 5)).toBe('');
	});

	it("says nothing for a group's roll-up, nor outside the model", () => {
		expect(laneCellTasks(l, rowOf(l, 'team'), 0)).toBe('');
		expect(laneCellTasks(l, 99, 0)).toBe('');
		expect(laneCellTasks(l, rowOf(l, 'a'), 999)).toBe('');
	});

	it('marks a task the editor cannot move', () => {
		const { text, line } = macroText();
		const t = lanesOf(text, 'week', { task: 'late', line });
		expect(laneCellTasks(t, rowOf(t, 'c'), 1)).toBe('works on late 16 h (text only)');
	});

	it('writes a quarter hour as a decimal', () => {
		const lanes = stub([{ task: 'x', minutes: 135 }]);
		expect(laneCellTasks(lanes, 0, 0)).toBe('works on X 2.25 h');
	});
});

/** A model with the few members `laneCellTasks` reads: one person row and these booked tasks. */
function stub(tasks: Array<{ task: string; minutes: number }>): LanesModel {
	const booked: CellTask[] = tasks.map((t) => ({ ...t, kind: 'booked', movable: true }));
	return {
		load: {
			rows: [{ id: 'p', name: 'P', depth: 0, group: false, expanded: null, textOnly: null }],
			cellTasks: () => booked,
		},
		taskName: (id: string) => id.toUpperCase(),
		isTextOnly: () => false,
	} as unknown as LanesModel;
}

describe('laneCellTasks past the cap', () => {
	it(`names ${MAX_NAMED} tasks and counts the rest`, () => {
		const many = Array.from({ length: MAX_NAMED + 3 }, (_, i) => ({ task: `t${i}`, minutes: 60 }));
		const text = laneCellTasks(stub(many), 0, 0);
		expect(text.startsWith('works on T0 1 h, T1 1 h')).toBe(true);
		expect(text.endsWith(' and 3 more')).toBe(true);
		expect(text.split(', ')).toHaveLength(MAX_NAMED);
	});

	it('names exactly the cap without a remainder', () => {
		const some = Array.from({ length: MAX_NAMED }, (_, i) => ({ task: `t${i}`, minutes: 60 }));
		expect(laneCellTasks(stub(some), 0, 0)).not.toContain('more');
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { addSpot, canAddSubtask, newTaskKeyFromHeader } from './add-task';
import type { Tree, TreeNode } from './reorder';

/** A tree from `[key, parent, id]` rows, children in the order given. */
function build(rows: ReadonlyArray<readonly [string, string | null, string | null]>): {
	tree: Tree;
	roots: string[];
} {
	const nodes = new Map<string, TreeNode>();
	for (const [key, parent, id] of rows) {
		nodes.set(key, {
			key,
			id,
			parent,
			children: rows.filter((r) => r[1] === key).map((r) => r[0]),
		});
	}
	return { tree: nodes, roots: rows.filter((r) => r[1] === null).map((r) => r[0]) };
}

// a, b (with children b1, b2), c
const plan = build([
	['task:a', null, 'a'],
	['task:b', null, 'b'],
	['task:b.b1', 'task:b', 'b.b1'],
	['task:b.b2', 'task:b', 'b.b2'],
	['task:c', null, 'c'],
]);

describe('addSpot', () => {
	it('adds after the selected task, in its parent', () => {
		expect(addSpot(plan.tree, plan.roots, 'task:a', 'after')).toEqual({
			parent: null,
			parentKey: null,
			index: 1,
		});
		expect(addSpot(plan.tree, plan.roots, 'task:b.b1', 'after')).toEqual({
			parent: 'b',
			parentKey: 'task:b',
			index: 1,
		});
	});

	it('adds at the end of the plan when nothing is selected', () => {
		expect(addSpot(plan.tree, plan.roots, null, 'after')).toEqual({
			parent: null,
			parentKey: null,
			index: 3,
		});
	});

	it('adds at the end of the plan when the selection is not in the outline', () => {
		expect(addSpot(plan.tree, plan.roots, 'task:gone', 'after')?.index).toBe(3);
	});

	it('adds at the end of an empty plan', () => {
		expect(addSpot(new Map(), [], null, 'after')).toEqual({
			parent: null,
			parentKey: null,
			index: 0,
		});
	});

	it('adds a subtask as the last child of the selected task', () => {
		expect(addSpot(plan.tree, plan.roots, 'task:b', 'subtask')).toEqual({
			parent: 'b',
			parentKey: 'task:b',
			index: 2,
		});
		expect(addSpot(plan.tree, plan.roots, 'task:a', 'subtask')).toEqual({
			parent: 'a',
			parentKey: 'task:a',
			index: 0,
		});
	});

	it('has no place for a subtask without a selection, or of a declaration with no id', () => {
		expect(addSpot(plan.tree, plan.roots, null, 'subtask')).toBeNull();
		const macro = build([['task:m', null, null]]);
		expect(addSpot(macro.tree, macro.roots, 'task:m', 'subtask')).toBeNull();
	});

	it('counts only the siblings the index resolved', () => {
		const t = build([
			['task:a', null, 'a'],
			['task:m', null, null],
			['task:c', null, 'c'],
		]);
		expect(addSpot(t.tree, t.roots, null, 'after')?.index).toBe(2);
		// After c, the macro-built one in front of it is not counted.
		expect(addSpot(t.tree, t.roots, 'task:c', 'after')?.index).toBe(2);
	});
});

describe('canAddSubtask', () => {
	it('needs a selected task that has an id', () => {
		expect(canAddSubtask(plan.tree, 'task:a')).toBe(true);
		expect(canAddSubtask(plan.tree, null)).toBe(false);
		expect(canAddSubtask(plan.tree, 'task:gone')).toBe(false);
		const macro = build([['task:m', null, null]]);
		expect(canAddSubtask(macro.tree, 'task:m')).toBe(false);
	});
});

describe('newTaskKeyFromHeader', () => {
	it('names the new task from its header and its parent', () => {
		expect(newTaskKeyFromHeader('task new_task "New task"', null)).toBe('task:new_task');
		expect(newTaskKeyFromHeader('task new_task2 "New task"', 'design')).toBe(
			'task:design.new_task2',
		);
	});

	it('is null for text that is not a task header', () => {
		expect(newTaskKeyFromHeader('milestone x', null)).toBeNull();
		expect(newTaskKeyFromHeader('', null)).toBeNull();
	});
});

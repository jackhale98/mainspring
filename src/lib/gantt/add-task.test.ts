// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { addSpot, newTaskKey } from './add-task';
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

describe('newTaskKey', () => {
	const before = new Set(['task:a', 'task:b', 'task:b.b1']);
	const nodes = [
		{ key: 'task:a', parent: null },
		{ key: 'task:new_task', parent: null },
		{ key: 'task:b', parent: null },
		{ key: 'task:b.b1', parent: 'task:b' },
		{ key: 'task:b.new_task', parent: 'task:b' },
	];

	it('finds the new node under the parent it was added to', () => {
		expect(newTaskKey(before, nodes, null)).toBe('task:new_task');
		expect(newTaskKey(before, nodes, 'task:b')).toBe('task:b.new_task');
	});

	it('is null while the index has not caught up', () => {
		expect(newTaskKey(before, nodes.slice(0, 1), null)).toBeNull();
		expect(newTaskKey(before, nodes, 'task:a')).toBeNull();
	});
});

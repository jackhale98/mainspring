// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	boundaryAt,
	dropTarget,
	placeNow,
	rootsOf,
	stepTarget,
	wantedDepth,
	type DropRow,
	type Tree,
	type TreeNode,
} from './reorder';

/**
 *   a            (container, open)
 *     a1
 *     a2
 *   b            (container, collapsed: b1 is not a visible row)
 *     b1
 *   c            (leaf)
 *   d            (leaf)
 */
const nodes: TreeNode[] = [
	{ key: 'a', id: 'a', parent: null, children: ['a1', 'a2'] },
	{ key: 'a1', id: 'a.a1', parent: 'a', children: [] },
	{ key: 'a2', id: 'a.a2', parent: 'a', children: [] },
	{ key: 'b', id: 'b', parent: null, children: ['b1'] },
	{ key: 'b1', id: 'b.b1', parent: 'b', children: [] },
	{ key: 'c', id: 'c', parent: null, children: [] },
	{ key: 'd', id: 'd', parent: null, children: [] },
];
const tree: Tree = new Map(nodes.map((n) => [n.key, n]));
const roots = rootsOf(
	tree,
	nodes.map((n) => n.key),
);
const rows: DropRow[] = [
	{ key: 'a', depth: 0, kind: 'container', expanded: true },
	{ key: 'a1', depth: 1, kind: 'task', expanded: null },
	{ key: 'a2', depth: 1, kind: 'task', expanded: null },
	{ key: 'b', depth: 0, kind: 'container', expanded: false },
	{ key: 'c', depth: 0, kind: 'task', expanded: null },
	{ key: 'd', depth: 0, kind: 'task', expanded: null },
];

describe('stepTarget (the keyboard)', () => {
	it('moves a row up and down among its siblings', () => {
		expect(stepTarget(tree, 'd', 'up', roots)).toEqual({ parent: null, parentKey: null, index: 2 });
		expect(stepTarget(tree, 'c', 'down', roots)).toEqual({
			parent: null,
			parentKey: null,
			index: 3,
		});
		expect(stepTarget(tree, 'a2', 'up', roots)).toEqual({ parent: 'a', parentKey: 'a', index: 0 });
	});

	it('has nowhere to go at the ends of its siblings', () => {
		expect(stepTarget(tree, 'a', 'up', roots)).toBeNull();
		expect(stepTarget(tree, 'd', 'down', roots)).toBeNull();
		expect(stepTarget(tree, 'a1', 'up', roots)).toBeNull();
	});

	it('indents under the sibling above, as its last child', () => {
		expect(stepTarget(tree, 'c', 'indent', roots)).toEqual({
			parent: 'b',
			parentKey: 'b',
			index: 1,
		});
		expect(stepTarget(tree, 'a', 'indent', roots)).toBeNull();
		expect(stepTarget(tree, 'a2', 'indent', roots)).toEqual({
			parent: 'a.a1',
			parentKey: 'a1',
			index: 0,
		});
	});

	it('outdents to just after its parent', () => {
		expect(stepTarget(tree, 'a1', 'outdent', roots)).toEqual({
			parent: null,
			parentKey: null,
			index: 1,
		});
		expect(stepTarget(tree, 'a2', 'outdent', roots)?.index).toBe(1);
		expect(stepTarget(tree, 'c', 'outdent', roots)).toBeNull();
	});
});

describe('placeNow', () => {
	it('is the parent and the index among the others', () => {
		expect(placeNow(tree, 'a2', roots)).toEqual({ parent: 'a', parentKey: 'a', index: 1 });
		expect(placeNow(tree, 'd', roots)).toEqual({ parent: null, parentKey: null, index: 3 });
	});
});

describe('dropTarget (the pointer)', () => {
	it('drops between two siblings at their depth', () => {
		// Between c and d, at depth 0: index 2 among the other roots (a, b, c).
		const t = dropTarget(rows, tree, roots, 'a1', 5, 0);
		expect(t).toMatchObject({ parent: null, index: 3, depth: 0, lineRow: 5, same: false });
	});

	it('nests into the container above when the pointer moves right', () => {
		// After a2 (the last of a), wanting depth 1: the last child of a, as the first place after a2.
		const t = dropTarget(rows, tree, roots, 'c', 3, 1);
		expect(t).toMatchObject({ parent: 'a', index: 2, depth: 1 });
		// Below the open container's last child at depth 0 puts it after a.
		expect(dropTarget(rows, tree, roots, 'c', 3, 0)).toMatchObject({ parent: null, index: 1 });
	});

	it('drops as the first child of an open container, right below it', () => {
		const t = dropTarget(rows, tree, roots, 'c', 1, 0);
		// Only depth 1 is possible between a and a1.
		expect(t).toMatchObject({ parent: 'a', index: 0, depth: 1 });
	});

	it('opens a collapsed container the row is nested into', () => {
		const t = dropTarget(rows, tree, roots, 'd', 4, 1);
		expect(t).toMatchObject({ parent: 'b', index: 1, depth: 1, opens: 'b' });
	});

	it('cannot nest under a leaf', () => {
		expect(dropTarget(rows, tree, roots, 'd', 5, 1)).toMatchObject({ parent: null, depth: 0 });
	});

	it('cannot drop a container into itself, and treats its own place as no change', () => {
		const into = dropTarget(rows, tree, roots, 'a', 2, 1);
		expect(into?.parent).not.toBe('a');
		const here = dropTarget(rows, tree, roots, 'c', 4, 0);
		expect(here?.same).toBe(true);
		const below = dropTarget(rows, tree, roots, 'c', 5, 0);
		expect(below?.same).toBe(true);
	});

	it('counts only children the index resolved', () => {
		const withMacro = new Map(tree);
		withMacro.set('a', {
			key: 'a',
			id: 'a',
			parent: null,
			children: ['x', 'a1', 'a2'],
		});
		withMacro.set('x', { key: 'x', id: null, parent: 'a', children: [] });
		const t = dropTarget(rows, withMacro, roots, 'c', 3, 1);
		expect(t).toMatchObject({ parent: 'a', index: 2 });
	});

	it('maps a pointer to a boundary and a depth', () => {
		expect(boundaryAt(59, 40, 6)).toBe(1);
		expect(boundaryAt(61, 40, 6)).toBe(2);
		expect(boundaryAt(-30, 40, 6)).toBe(0);
		expect(boundaryAt(9999, 40, 6)).toBe(6);
		expect(wantedDepth(1, 33)).toBe(3);
		expect(wantedDepth(2, -17)).toBe(1);
		expect(wantedDepth(0, 7)).toBe(0);
	});
});

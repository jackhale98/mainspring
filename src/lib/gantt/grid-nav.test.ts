// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { gridMove, type GridFocus, type GridKey, type GridShape } from './grid-nav';

// 0 App (open)   1 UI (leaf)   2 API (leaf)   3 Docs (closed)   4 Misc (leaf)
const EXPANDED = [true, null, null, false, null];
const PARENT = [-1, 0, 0, -1, -1];
const shape: GridShape = {
	rows: 5,
	cols: 3,
	page: 2,
	expanded: (r) => EXPANDED[r] ?? null,
	parent: (r) => PARENT[r] ?? -1,
};
const key = (k: string, over: Partial<GridKey> = {}): GridKey => ({
	key: k,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...over,
});
const row = (r: number): GridFocus => ({ row: r, col: null });
const cell = (r: number, c: number): GridFocus => ({ row: r, col: c });
const focus = (r: number, c: number | null) => ({ kind: 'focus', to: { row: r, col: c } });

describe('gridMove between rows', () => {
	it('moves down and up, and stops at the ends', () => {
		expect(gridMove(row(1), key('ArrowDown'), shape)).toEqual(focus(2, null));
		expect(gridMove(row(1), key('ArrowUp'), shape)).toEqual(focus(0, null));
		expect(gridMove(row(4), key('ArrowDown'), shape)).toEqual(focus(4, null));
		expect(gridMove(row(0), key('ArrowUp'), shape)).toEqual(focus(0, null));
	});

	it('keeps the column going up and down', () => {
		expect(gridMove(cell(1, 2), key('ArrowDown'), shape)).toEqual(focus(2, 2));
	});

	it('goes a page at a time', () => {
		expect(gridMove(row(0), key('PageDown'), shape)).toEqual(focus(2, null));
		expect(gridMove(row(1), key('PageDown'), shape)).toEqual(focus(3, null));
		expect(gridMove(row(3), key('PageUp'), shape)).toEqual(focus(1, null));
		expect(gridMove(row(3), key('PageDown'), shape)).toEqual(focus(4, null));
	});
});

describe('gridMove Home and End', () => {
	it('go to the first and last row from a row', () => {
		expect(gridMove(row(2), key('Home'), shape)).toEqual(focus(0, null));
		expect(gridMove(row(2), key('End'), shape)).toEqual(focus(4, null));
	});

	it('go to the first and last cell from a cell', () => {
		expect(gridMove(cell(2, 1), key('Home'), shape)).toEqual(focus(2, 0));
		expect(gridMove(cell(2, 1), key('End'), shape)).toEqual(focus(2, 2));
	});

	it('with Ctrl go to the first and last row and keep the column', () => {
		expect(gridMove(cell(2, 1), key('Home', { ctrlKey: true }), shape)).toEqual(focus(0, 1));
		expect(gridMove(cell(2, 1), key('End', { metaKey: true }), shape)).toEqual(focus(4, 1));
		expect(gridMove(row(2), key('End', { ctrlKey: true }), shape)).toEqual(focus(4, null));
	});
});

describe('gridMove Left and Right', () => {
	it('expands a collapsed row, and goes into an expanded row or a leaf', () => {
		expect(gridMove(row(3), key('ArrowRight'), shape)).toEqual({
			kind: 'toggle',
			row: 3,
			open: true,
		});
		expect(gridMove(row(0), key('ArrowRight'), shape)).toEqual(focus(0, 0));
		expect(gridMove(row(1), key('ArrowRight'), shape)).toEqual(focus(1, 0));
	});

	it('collapses an expanded row, and goes to the parent from a leaf or a closed row', () => {
		expect(gridMove(row(0), key('ArrowLeft'), shape)).toEqual({
			kind: 'toggle',
			row: 0,
			open: false,
		});
		expect(gridMove(row(1), key('ArrowLeft'), shape)).toEqual(focus(0, null));
		expect(gridMove(row(3), key('ArrowLeft'), shape)).toEqual({ kind: 'ignore' });
	});

	it('moves between cells, and back to the row from the first cell', () => {
		expect(gridMove(cell(1, 0), key('ArrowRight'), shape)).toEqual(focus(1, 1));
		expect(gridMove(cell(1, 2), key('ArrowRight'), shape)).toEqual(focus(1, 2));
		expect(gridMove(cell(1, 2), key('ArrowLeft'), shape)).toEqual(focus(1, 1));
		expect(gridMove(cell(1, 0), key('ArrowLeft'), shape)).toEqual(focus(1, null));
	});
});

describe('gridMove actions', () => {
	it('opens on Enter, selects on Space and renames on F2, from a row or a cell', () => {
		expect(gridMove(row(2), key('Enter'), shape)).toEqual({ kind: 'open', row: 2 });
		expect(gridMove(cell(2, 1), key(' '), shape)).toEqual({ kind: 'select', row: 2 });
		expect(gridMove(row(2), key('F2'), shape)).toEqual({ kind: 'rename', row: 2 });
	});

	it('leaves Alt, Shift and Ctrl combinations to the shortcuts and the browser', () => {
		for (const over of [{ altKey: true }, { shiftKey: true }, { ctrlKey: true }]) {
			expect(gridMove(row(1), key('ArrowDown', over), shape)).toEqual({ kind: 'ignore' });
		}
	});

	it('ignores other keys, and an empty grid', () => {
		expect(gridMove(row(1), key('a'), shape)).toEqual({ kind: 'ignore' });
		expect(gridMove(row(0), key('ArrowDown'), { ...shape, rows: 0 })).toEqual({ kind: 'ignore' });
	});

	it('clamps a stale focus to the rows that exist', () => {
		expect(gridMove(row(40), key('ArrowUp'), shape)).toEqual(focus(3, null));
	});
});

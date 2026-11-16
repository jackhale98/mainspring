// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's geometry (phase-3.md 8.1), shared by painting, hit testing, the ARIA mirror and
 * the gestures so that what a pointer hits is what was drawn. Everything is in CSS pixels in
 * "content coordinates": x = 0 is the left edge of the first column, y = 0 the top of the first
 * row; the time header and the name column sit outside it. Every cell is the same size: a column
 * is one bucket of the axis (a day, a week or a month, which differ in length but not in width),
 * and a row is one line of the model.
 *
 * Pure: sizes and counts in, positions out. It reads no DOM, no clock and no schedule.
 */
import type { Minutes } from '../../engine/protocol';
import type { BucketAxis } from './types';

export interface HeatSizes {
	readonly rowHeight: number;
	readonly colWidth: number;
}

/** A rectangle in content coordinates. */
export interface Box {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/** A half-open block of cells: rows [r0, r1) and columns [c0, c1). */
export interface CellRange {
	readonly r0: number;
	readonly r1: number;
	readonly c0: number;
	readonly c1: number;
}

export interface Cell {
	readonly row: number;
	readonly col: number;
}

export interface HeatLayout {
	readonly rows: number;
	readonly cols: number;
	readonly rowHeight: number;
	readonly colWidth: number;
	readonly width: number;
	readonly height: number;
	rowTop(row: number): number;
	colLeft(col: number): number;
	/** The cell box. */
	box(cell: Cell): Box;
	/** The row at a content y, or -1 outside the rows. */
	rowAt(y: number): number;
	/** The column at a content x, or -1 outside the columns. */
	colAt(x: number): number;
	/** The cell at a point, or null outside the grid. */
	cellAt(x: number, y: number): Cell | null;
	/** The cells a window touches, with `rowPad` and `colPad` more on every side. */
	range(win: Box, rowPad: number, colPad: number): CellRange;
	/** The content x of a minute (inside its bucket, in proportion), or null outside the frame. */
	xOfMinute(axis: BucketAxis, m: Minutes): number | null;
	/** The minute at a content x, clamped to the first and last bucket. */
	minuteAtX(axis: BucketAxis, x: number): Minutes;
}

export function heatLayout(rows: number, cols: number, sizes: HeatSizes): HeatLayout {
	const { rowHeight, colWidth } = sizes;
	const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
	const layout: HeatLayout = {
		rows,
		cols,
		rowHeight,
		colWidth,
		width: cols * colWidth,
		height: rows * rowHeight,
		rowTop: (row) => row * rowHeight,
		colLeft: (col) => col * colWidth,
		box: (c) => ({ x: c.col * colWidth, y: c.row * rowHeight, w: colWidth, h: rowHeight }),
		rowAt: (y) => (y >= 0 && y < rows * rowHeight ? Math.floor(y / rowHeight) : -1),
		colAt: (x) => (x >= 0 && x < cols * colWidth ? Math.floor(x / colWidth) : -1),
		cellAt(x, y) {
			const row = layout.rowAt(y);
			const col = layout.colAt(x);
			return row < 0 || col < 0 ? null : { row, col };
		},
		range(win, rowPad, colPad) {
			const r0 = clamp(Math.floor(win.y / rowHeight) - rowPad, 0, rows);
			const r1 = clamp(Math.ceil((win.y + win.h) / rowHeight) + rowPad, 0, rows);
			const c0 = clamp(Math.floor(win.x / colWidth) - colPad, 0, cols);
			const c1 = clamp(Math.ceil((win.x + win.w) / colWidth) + colPad, 0, cols);
			return { r0, r1: Math.max(r0, r1), c0, c1: Math.max(c0, c1) };
		},
		xOfMinute(axis, m) {
			const col = axis.indexOf(m);
			if (col < 0 || col >= cols) return null;
			const from = axis.bounds[col] as number;
			const to = axis.bounds[col + 1] as number;
			return col * colWidth + (to > from ? ((m - from) / (to - from)) * colWidth : 0);
		},
		minuteAtX(axis, x) {
			if (cols === 0) return 0;
			const col = clamp(Math.floor(x / colWidth), 0, cols - 1);
			const from = axis.bounds[col] as number;
			const to = axis.bounds[col + 1] as number;
			return Math.round(from + clamp((x - col * colWidth) / colWidth, 0, 1) * (to - from));
		},
	};
	return layout;
}

/** The cell as one number, for a gesture target (`GestureTarget` bars carry a single index). */
export const cellId = (c: Cell, cols: number): number => c.row * cols + c.col;
export const cellOfId = (id: number, cols: number): Cell => ({
	row: Math.floor(id / cols),
	col: id % cols,
});

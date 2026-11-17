// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { cellId, cellOfId, heatLayout } from './heat-layout';
import type { BucketAxis } from './types';

/** Three week buckets from minute -1440 (a Sunday start), 10080 minutes each, the last partial. */
const axis: BucketAxis = {
	kind: 'week',
	bounds: Int32Array.of(-1440, 8640, 18720, 22000),
	count: 3,
	indexOf(m) {
		if (m < 0 || m >= 22000) return -1;
		return m < 8640 ? 0 : m < 18720 ? 1 : 2;
	},
};

describe('heat layout', () => {
	const l = heatLayout(4, 3, { rowHeight: 28, colWidth: 56 });

	it('sizes the content by rows and columns', () => {
		expect(l.width).toBe(168);
		expect(l.height).toBe(112);
		expect(l.box({ row: 2, col: 1 })).toEqual({ x: 56, y: 56, w: 56, h: 28 });
		expect(l.rowTop(3)).toBe(84);
		expect(l.colLeft(2)).toBe(112);
	});

	it('hits the cell under a point, and nothing outside the grid', () => {
		expect(l.cellAt(0, 0)).toEqual({ row: 0, col: 0 });
		expect(l.cellAt(55.9, 27.9)).toEqual({ row: 0, col: 0 });
		expect(l.cellAt(56, 28)).toEqual({ row: 1, col: 1 });
		expect(l.cellAt(167.9, 111.9)).toEqual({ row: 3, col: 2 });
		for (const [x, y] of [
			[-1, 0],
			[0, -1],
			[168, 0],
			[0, 112],
		] as const) {
			expect(l.cellAt(x, y)).toBeNull();
		}
	});

	it('gives the cells a window touches, padded and clamped', () => {
		expect(l.range({ x: 60, y: 30, w: 50, h: 20 }, 0, 0)).toEqual({ r0: 1, r1: 2, c0: 1, c1: 2 });
		expect(l.range({ x: 60, y: 30, w: 50, h: 20 }, 1, 1)).toEqual({ r0: 0, r1: 3, c0: 0, c1: 3 });
		expect(l.range({ x: -500, y: -500, w: 10, h: 10 }, 0, 0)).toEqual({
			r0: 0,
			r1: 0,
			c0: 0,
			c1: 0,
		});
		expect(l.range({ x: 0, y: 0, w: 9999, h: 9999 }, 5, 5)).toEqual({
			r0: 0,
			r1: 4,
			c0: 0,
			c1: 3,
		});
	});

	it('maps a minute to a x inside its bucket and back', () => {
		expect(l.xOfMinute(axis, 0)).toBeCloseTo((1440 / 10080) * 56, 6);
		expect(l.xOfMinute(axis, 8640)).toBe(56);
		expect(l.xOfMinute(axis, 18720 + 1640)).toBeCloseTo(112 + 28, 6);
		expect(l.xOfMinute(axis, -1)).toBeNull();
		expect(l.xOfMinute(axis, 22000)).toBeNull();
		expect(l.minuteAtX(axis, 56)).toBe(8640);
		expect(l.minuteAtX(axis, 56 + 28)).toBe(8640 + 5040);
		// Clamped to the first and last bucket.
		expect(l.minuteAtX(axis, -50)).toBe(-1440);
		expect(l.minuteAtX(axis, 9999)).toBe(22000);
	});

	it('handles an empty grid', () => {
		const e = heatLayout(0, 0, { rowHeight: 28, colWidth: 56 });
		expect(e.cellAt(0, 0)).toBeNull();
		expect(e.minuteAtX(axis, 10)).toBe(0);
		expect(e.range({ x: 0, y: 0, w: 100, h: 100 }, 1, 1)).toEqual({ r0: 0, r1: 0, c0: 0, c1: 0 });
	});

	it('round-trips a cell through its id', () => {
		for (const c of [
			{ row: 0, col: 0 },
			{ row: 3, col: 2 },
			{ row: 1, col: 1 },
		]) {
			expect(cellOfId(cellId(c, 3), 3)).toEqual(c);
		}
	});
});

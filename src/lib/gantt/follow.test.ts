// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { followOffsets, type FollowInput } from './follow';

const base: FollowInput = {
	row: 10,
	rowHeight: 28,
	top: 0,
	left: 100,
	viewW: 600,
	viewH: 280,
	bar: { x0: 150, x1: 300 },
};

describe('followOffsets', () => {
	it('leaves the view alone when the row and the bar are in it', () => {
		expect(followOffsets({ ...base, row: 3 })).toEqual({ top: 0, left: 100 });
	});

	it('scrolls down only as far as it takes to show the row, and up to it', () => {
		expect(followOffsets({ ...base, row: 20 }).top).toBe(20 * 28 + 28 - 280);
		expect(followOffsets({ ...base, row: 2, top: 400 }).top).toBe(56);
	});

	it('scrolls sideways only when no part of the bar is in view', () => {
		// Partly in view: stays.
		expect(followOffsets({ ...base, bar: { x0: 650, x1: 900 } }).left).toBe(100);
		// Past the right edge, before the left edge: the bar starts a quarter in.
		expect(followOffsets({ ...base, bar: { x0: 1000, x1: 1100 } }).left).toBe(850);
		expect(followOffsets({ ...base, left: 800, bar: { x0: 10, x1: 60 } }).left).toBe(0);
	});

	it('leaves the sideways scroll alone for a task with no bar, or no width yet', () => {
		expect(followOffsets({ ...base, bar: null }).left).toBe(100);
		expect(followOffsets({ ...base, viewW: 0, bar: { x0: 5000, x1: 5100 } }).left).toBe(100);
	});
});

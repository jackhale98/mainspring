// SPDX-License-Identifier: GPL-2.0-or-later
// Which month blocks of the list are mounted (window.ts): the ones in view, a margin, and the kept.
import { describe, expect, it } from 'vitest';
import { monthWindow, offsetOfMonth, visibleMonths } from './window';

describe('visibleMonths', () => {
	it('finds the first and last block that show', () => {
		// Blocks of 300 px; a 700 px view scrolled to 450 shows blocks 1 (450 to 600), 2 and 3 (to 1150).
		expect(visibleMonths(450, 700, 300, 20)).toEqual([1, 3]);
		expect(visibleMonths(0, 300, 300, 20)).toEqual([0, 0]);
		expect(visibleMonths(0, 301, 300, 20)).toEqual([0, 1]);
	});

	it('stays inside the list', () => {
		expect(visibleMonths(10_000, 700, 300, 5)).toEqual([4, 4]);
		expect(visibleMonths(-50, 700, 300, 5)).toEqual([0, 2]);
	});

	it('shows nothing before the first measure or with no months', () => {
		expect(visibleMonths(0, 700, 0, 5)).toEqual([0, -1]);
		expect(visibleMonths(0, 700, 300, 0)).toEqual([0, -1]);
	});
});

describe('monthWindow', () => {
	it('adds the overscan either side', () => {
		expect(monthWindow(900, 600, 300, 20, 1, [])).toEqual([2, 3, 4, 5]);
		expect(monthWindow(0, 600, 300, 20, 2, [])).toEqual([0, 1, 2, 3]);
	});

	it('keeps the block with the focus, wherever it is, in order', () => {
		expect(monthWindow(0, 300, 300, 20, 0, [12, null, 99, -1])).toEqual([0, 12]);
	});

	it('mounts only a window of a long plan', () => {
		const w = monthWindow(30 * 300, 800, 300, 120, 1, []);
		expect(w.length).toBeLessThanOrEqual(6);
		expect(w[0]).toBe(29);
	});

	it('places a block by its index', () => {
		expect(offsetOfMonth(3, 300)).toBe(900);
		expect(offsetOfMonth(-1, 300)).toBe(0);
	});
});

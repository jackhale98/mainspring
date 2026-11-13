// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Burst } from './burst';

describe('Burst', () => {
	it('keeps the value from before the burst and sends cumulative totals', () => {
		const b = new Burst();
		expect(b.held).toBe(false);
		expect(b.press(3, 1)).toBe(1);
		expect(b.press(3, 1)).toBe(2);
		// The plan's text may have moved on meanwhile; the base does not.
		expect(b.press(4, 1)).toBe(3);
		expect(b.base).toBe(3);
		expect(b.held).toBe(true);
		b.release();
		expect(b.held).toBe(false);
		expect(b.total).toBe(0);
		expect(b.press(6, -1)).toBe(-1);
		expect(b.base).toBe(6);
	});

	it('stops at its limits and does not count presses past them', () => {
		const b = new Burst(1, 3);
		expect(b.press(2, 5)).toBe(1);
		expect(b.press(2, 1)).toBe(1);
		expect(b.press(2, -1)).toBe(0);
		expect(b.press(2, -5)).toBe(-1);
	});
});

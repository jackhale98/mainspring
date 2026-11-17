// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createWheelPager, wheelPx } from './wheel';

describe('the wheel pager', () => {
	it('moves one month for a notch, and once more for the next notch after a pause', () => {
		const w = createWheelPager();
		expect(w.push(100, 0)).toBe(1);
		expect(w.push(100, 500)).toBe(1);
		expect(w.push(-100, 1000)).toBe(-1);
	});

	it('adds up a trackpad swipe and moves once, however long the inertia runs', () => {
		const w = createWheelPager();
		const out: number[] = [];
		for (let i = 0; i < 60; i++) out.push(w.push(4 + (i < 30 ? i : 60 - i), i * 16));
		expect(out.filter((s) => s !== 0)).toEqual([1]);
		// Still going within the quiet gap: no second month.
		expect(w.push(40, 60 * 16 + 100)).toBe(0);
	});

	it('does not move for a small nudge, and forgets it after a pause', () => {
		const w = createWheelPager();
		expect(w.push(20, 0)).toBe(0);
		expect(w.push(20, 50)).toBe(0);
		// The pause: the 40 px before do not count towards this one.
		expect(w.push(30, 1000)).toBe(0);
		expect(w.push(40, 1050)).toBe(1);
	});

	it('goes back with a negative delta and a swipe that turns round does not move twice', () => {
		const w = createWheelPager();
		expect(w.push(-80, 0)).toBe(-1);
		expect(w.push(200, 50)).toBe(0);
	});

	it('reset starts a gesture over', () => {
		const w = createWheelPager();
		expect(w.push(100, 0)).toBe(1);
		w.reset();
		expect(w.push(100, 10)).toBe(1);
	});

	it('reads lines and pages as pixels', () => {
		expect(wheelPx(3, 1, 600)).toBe(48);
		expect(wheelPx(1, 2, 600)).toBe(600);
		expect(wheelPx(100, 0, 600)).toBe(100);
	});
});

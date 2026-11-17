// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { WHEEL_THRESHOLD, createWheelPager, wheelPx } from './wheel';

describe('the wheel pager', () => {
	it('moves one month for a notch, and once more for the next notch after a pause', () => {
		const w = createWheelPager();
		expect(w.push(100, 0)).toBe(1);
		expect(w.push(100, 500)).toBe(1);
		expect(w.push(-100, 1000)).toBe(-1);
	});

	it('a single notch pages, in pixels or in lines and pages', () => {
		for (const [dy, mode] of [
			[100, 0],
			[3, 1],
			[1, 2],
			[-3, 1],
		] as const) {
			const w = createWheelPager();
			expect(Math.abs(w.push(wheelPx(dy, mode), 0))).toBe(1);
		}
	});

	it('does not page twice for the notches of one fast spin', () => {
		const w = createWheelPager();
		expect(w.push(100, 0)).toBe(1);
		expect(w.push(100, 60)).toBe(0);
		expect(w.push(100, 120)).toBe(0);
	});

	it('adds up a trackpad swipe and moves once, however long the inertia runs', () => {
		const w = createWheelPager();
		const out: number[] = [];
		for (let i = 0; i < 60; i++) out.push(w.push(4 + (i < 30 ? i : 60 - i), i * 16));
		expect(out.filter((s) => s !== 0)).toEqual([1]);
		// Still going within the quiet gap: no second month.
		expect(w.push(40, 60 * 16 + 100)).toBe(0);
	});

	it('does not move for a small nudge, and forgets it after a long pause', () => {
		const w = createWheelPager();
		expect(w.push(20, 0)).toBe(0);
		expect(w.push(20, 50)).toBe(0);
		// The pause: the 40 px before do not count towards this one.
		expect(w.push(30, 1000)).toBe(0);
		expect(w.push(40, 1050)).toBe(1);
	});

	it('pages on slow small ticks that add up within the longer window', () => {
		const w = createWheelPager();
		// 25 px every 250 ms: more than the stillness of a gesture, less than the window.
		expect(w.push(25, 0)).toBe(0);
		expect(w.push(25, 250)).toBe(0);
		expect(w.push(25, 500)).toBe(1);
	});

	it('a turn the other way starts the sum again', () => {
		const w = createWheelPager();
		expect(w.push(40, 0)).toBe(0);
		expect(w.push(-40, 30)).toBe(0);
		expect(w.push(-40, 60)).toBe(-1);
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

	it('reads lines and pages as a full step in the direction of the delta', () => {
		expect(wheelPx(3, 1)).toBe(WHEEL_THRESHOLD);
		expect(wheelPx(-1, 2)).toBe(-WHEEL_THRESHOLD);
		expect(wheelPx(100, 0)).toBe(100);
	});
});

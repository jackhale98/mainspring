// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { paintWindow } from './paint-window';

describe('paintWindow', () => {
	// The margin is 20% of the view, at least 120 and 160 px, and at most the caller's: 160 and 160 here.
	const opt = { overscanX: 300, overscanY: 280 };
	const content = { w: 10_000, h: 14_000 };
	const view = { x: 2000, y: 3000, w: 800, h: 500 };

	it('covers the view with a modest margin, not several times the view, inside the content', () => {
		const w = paintWindow(view, content, opt, null);
		expect(w).toEqual({ x: 1840, y: 2840, w: 1120, h: 820 });
		// Well under the old window, which was about 3.7 times the view.
		expect(w.w * w.h).toBeLessThan(2.5 * view.w * view.h);
		const edge = paintWindow({ x: 0, y: 0, w: 800, h: 500 }, content, opt, null);
		expect(edge).toMatchObject({ x: 0, y: 0 });
		const end = paintWindow({ x: 9200, y: 13_500, w: 800, h: 500 }, content, opt, null);
		expect(end.x + end.w).toBe(10_000);
		expect(end.y + end.h).toBe(14_000);
	});

	it('caps the margin at the most the caller allows, and keeps a minimum on a small view', () => {
		const big = paintWindow({ x: 3000, y: 3000, w: 3000, h: 3000 }, content, opt, null);
		expect(big).toMatchObject({ w: 3000 + 600, h: 3000 + 560 });
		const phone = paintWindow({ x: 3000, y: 3000, w: 288, h: 600 }, content, opt, null);
		expect(phone).toMatchObject({ w: 288 + 240, h: 600 + 320 });
	});

	it('keeps the same window until a third of the margin on a side is used', () => {
		const first = paintWindow(view, content, opt, null);
		// Two thirds of the margin are left: 107 px of 160, sideways and vertically.
		const x = paintWindow({ ...view, x: 2000 + 50 }, content, opt, first);
		expect(x).toBe(first);
		const y = paintWindow({ ...view, y: 3000 + 50 }, content, opt, first);
		expect(y).toBe(first);
		// More than a third used.
		expect(paintWindow({ ...view, x: 2000 + 60 }, content, opt, first)).not.toBe(first);
		expect(paintWindow({ ...view, y: 3000 + 60 }, content, opt, first)).not.toBe(first);
		expect(paintWindow({ ...view, y: 3000 - 60 }, content, opt, first)).not.toBe(first);
	});

	it('puts most of its room ahead of the view when it moves, so the next move is far off', () => {
		const first = paintWindow(view, content, opt, null);
		// Heading down: 90 px later the vertical margin of 160 is used by more than a third.
		const down = paintWindow({ ...view, y: 3000 + 60 }, content, opt, first);
		// Room of 320: a quarter of it behind the view, three quarters ahead.
		expect(down.y).toBe(3060 - 80);
		expect(down.x).toBe(first.x);
		// The view can go on for 0.75 * 320 - 2/3 * 160 = 133 px before the next move...
		expect(paintWindow({ ...view, y: 3060 + 130 }, content, opt, down)).toBe(down);
		expect(paintWindow({ ...view, y: 3060 + 140 }, content, opt, down)).not.toBe(down);
		// ...and back only 0.25 * 320 - 0.15 * 160 = 56 px.
		expect(paintWindow({ ...view, y: 3060 - 50 }, content, opt, down)).toBe(down);
		const back = paintWindow({ ...view, y: 3060 - 60 }, content, opt, down);
		expect(back).not.toBe(down);
		// Heading up now: the room is above the view.
		expect(back.y).toBe(3000 - 240);
		const home = paintWindow({ x: 0, y: 0, w: 800, h: 500 }, content, opt, first);
		expect(home).toMatchObject({ x: 0, y: 0 });
	});

	it('moves rarely over a long scroll: about one window per half a view of travel', () => {
		let win = paintWindow({ ...view, y: 0 }, content, opt, null);
		let moves = 0;
		for (let y = 0; y <= 10_000; y += 10) {
			const next = paintWindow({ ...view, y }, content, opt, win);
			if (next !== win) {
				moves++;
				// The top is on a multiple of the snap, so that a vertical move is whole dash steps.
				expect(next.y % 20).toBe(0);
			}
			win = next;
		}
		// 133 px or so of headroom before a move, and 0.75 * 320 = 240 px of room: about 10000 / 200.
		expect(moves).toBeGreaterThan(30);
		expect(moves).toBeLessThan(80);
	});

	it('is a single window when the content is smaller than the view plus the margin', () => {
		const small = { w: 900, h: 300 };
		const first = paintWindow({ x: 0, y: 0, w: 800, h: 500 }, small, opt, null);
		expect(first).toEqual({ x: 0, y: 0, w: 900, h: 300 });
		expect(paintWindow({ x: 100, y: 0, w: 800, h: 500 }, small, opt, first)).toBe(first);
	});

	it('makes a new window when the viewport is resized', () => {
		const first = paintWindow(view, content, opt, null);
		const bigger = paintWindow({ ...view, w: 1000 }, content, opt, first);
		expect(bigger.w).toBe(1000 + 400);
	});
});

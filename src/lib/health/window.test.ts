// SPDX-License-Identifier: GPL-2.0-or-later
// The health list's window (window.ts): what is mounted for a scroll position, with spacers that
// keep the list's height, measured and estimated heights, the overscan, and the rows the focus keeps.
import { describe, expect, it } from 'vitest';
import { ESTIMATE, KEEP_AFTER, KEEP_BEFORE, OVERSCAN, windowOf } from './window';

const rows = (n: number, h?: number): Array<number | undefined> => new Array(n).fill(h);

describe('windowOf', () => {
	it('an empty list mounts nothing', () => {
		expect(windowOf([], 0, 500)).toEqual({ start: 0, end: 0, before: 0, after: 0 });
	});

	it('mounts the visible rows and an overscan each side, with spacers for the rest', () => {
		// 100 rows of 100 px; the scroller shows 1,000 to 1,500 px: rows 10 to 14.
		const w = windowOf(rows(100, 100), 1000, 1500);
		expect(w.start).toBe(10 - OVERSCAN);
		expect(w.end).toBe(15 + OVERSCAN);
		expect(w.before).toBe(w.start * 100);
		expect(w.after).toBe((100 - w.end) * 100);
		// The list keeps its height: spacers and mounted rows add up.
		expect(w.before + (w.end - w.start) * 100 + w.after).toBe(10_000);
	});

	it('at the top it starts at 0, and at the bottom it ends at the last row', () => {
		expect(windowOf(rows(100, 100), 0, 400).start).toBe(0);
		const bottom = windowOf(rows(100, 100), 9_600, 10_000);
		expect(bottom.end).toBe(100);
		expect(bottom.after).toBe(0);
	});

	it('a short list is mounted whole', () => {
		const w = windowOf(rows(8, 100), 0, 600);
		expect([w.start, w.end, w.before, w.after]).toEqual([0, 8, 0, 0]);
	});

	it('takes an unmeasured row to be the average of the measured ones, or the estimate', () => {
		const w = windowOf(rows(50), 0, 300);
		expect(w.after).toBe((50 - w.end) * ESTIMATE);
		const mixed = [200, 200, undefined, undefined, ...rows(46)];
		const m = windowOf(mixed, 0, 100);
		// 4 unmeasured rows at the average of the measured ones (200 px).
		expect(m.after).toBe((50 - m.end) * 200);
	});

	it("uses each row's own height", () => {
		const h = [50, 400, 50, 400, ...rows(60, 100)];
		const w = windowOf(h, 460, 520);
		// Row 1 ends at 450, row 2 spans 450 to 500: the first visible row is 2.
		expect(w.start).toBe(Math.max(0, 2 - OVERSCAN));
		expect(w.before).toBe(h.slice(0, w.start).reduce<number>((n, x) => n + (x ?? 0), 0));
	});

	it('keeps the row that has the focus, and the few after it, however far the scroll is', () => {
		const w = windowOf(rows(100, 100), 0, 400, 60);
		expect(w.start).toBeLessThanOrEqual(0);
		expect(w.end).toBe(60 + KEEP_AFTER + 1);
		const low = windowOf(rows(100, 100), 9_600, 10_000, 3);
		expect(low.start).toBe(Math.max(0, 3 - KEEP_BEFORE));
		expect(low.end).toBe(100);
	});

	it('a scroll position past the list still mounts the last rows', () => {
		const w = windowOf(rows(20, 100), 50_000, 50_500);
		expect(w.end).toBe(20);
		expect(w.start).toBeLessThan(20);
	});
});

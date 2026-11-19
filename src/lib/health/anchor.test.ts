// SPDX-License-Identifier: GPL-2.0-or-later
// What keeps the health list still while it is measured (anchor.ts): the anchor and the scroll it
// asks for, the height bookkeeping, and the whole loop (window, measure, anchor) on a list whose rows
// are unmeasured, which settles with the first visible row where it was.
import { describe, expect, it } from 'vitest';
import { anchorShift, pickAnchor, remember, resizeShift, type RowBox } from './anchor';
import { estimateOf, windowOf, type Windowed } from './window';

const box = (key: string, top: number, h: number): RowBox => ({ key, top, bottom: top + h });

describe('pickAnchor', () => {
	const rows = [box('a', 400, 100), box('b', 500, 100), box('c', 600, 100)];

	it('is the first mounted row that reaches the visible part', () => {
		expect(pickAnchor(rows, 2000, 450)).toEqual({ kind: 'row', key: 'a', top: 400 });
		expect(pickAnchor(rows, 2000, 500)).toEqual({ kind: 'row', key: 'b', top: 500 });
	});

	it('is nothing for a list that starts at or below the top of the scroller', () => {
		expect(pickAnchor(rows, 2000, 0)).toBeNull();
		expect(pickAnchor(rows, 2000, -300)).toBeNull();
	});

	it('is the list height for a list that ends above the scroller', () => {
		expect(pickAnchor(rows, 2000, 2000)).toEqual({ kind: 'end', height: 2000 });
		expect(pickAnchor(rows, 2000, 5000)).toEqual({ kind: 'end', height: 2000 });
	});

	it('is nothing when no mounted row reaches the visible part', () => {
		expect(pickAnchor(rows, 2000, 1500)).toBeNull();
	});
});

describe('anchorShift', () => {
	it('is how far the anchor row moved', () => {
		const anchor = pickAnchor([box('a', 400, 100)], 2000, 450);
		expect(anchorShift(anchor, [box('a', 640, 100)], 2400)).toBe(240);
		expect(anchorShift(anchor, [box('a', 380, 100)], 1900)).toBe(-20);
		expect(anchorShift(anchor, [box('a', 400, 100)], 2400)).toBe(0);
	});

	it('is how far the list grew, for a list above the scroller', () => {
		expect(anchorShift({ kind: 'end', height: 2000 }, [], 1650)).toBe(-350);
	});

	it('is 0 without an anchor, or when its row is gone', () => {
		expect(anchorShift(null, [box('a', 1, 1)], 100)).toBe(0);
		expect(anchorShift({ kind: 'row', key: 'x', top: 10 }, [box('a', 1, 1)], 100)).toBe(0);
	});
});

describe('resizeShift', () => {
	it('moves the view for a row that ended above it, and not for one that did not', () => {
		expect(resizeShift(80, 100, 164)).toBe(164);
		expect(resizeShift(100, 100, -20)).toBe(-20);
		expect(resizeShift(101, 100, 164)).toBe(0);
	});
});

describe('remember', () => {
	it('returns the same map when nothing changed, so nothing downstream runs again', () => {
		const known = new Map([['a', 100]]);
		expect(remember(known, [['a', 100]])).toBe(known);
		expect(remember(known, [['a', 100.4]])).toBe(known);
		expect(remember(known, [])).toBe(known);
	});

	it('adds and changes heights in a new map, and leaves the old one alone', () => {
		const known = new Map([['a', 100]]);
		const next = remember(known, [
			['a', 164],
			['b', 120],
		]);
		expect(next).not.toBe(known);
		expect([...next]).toEqual([
			['a', 164],
			['b', 120],
		]);
		expect(known.get('a')).toBe(100);
	});

	it('keeps the height of a row that is not in the update (an unmounted row is never forgotten)', () => {
		const next = remember(new Map([['gone', 164]]), [['here', 120]]);
		expect(next.get('gone')).toBe(164);
	});
});

describe('a list that is measured as it is scrolled', () => {
	const N = 80;
	const TRUE = Array.from({ length: N }, (_, i) => 90 + ((i * 37) % 90));
	const key = (i: number): string => `k${i}`;

	/** What the DOM holds for a window: the spacer, the mounted rows at their true heights, the spacer. */
	function layout(w: Windowed): { rows: RowBox[]; height: number } {
		const rows: RowBox[] = [];
		let y = w.before;
		for (let i = w.start; i < w.end; i++) {
			rows.push(box(key(i), y, TRUE[i] as number));
			y += TRUE[i] as number;
		}
		return { rows, height: y + w.after };
	}

	/** Runs window, anchor and measure until nothing changes; returns what the first visible row did. */
	function run(anchored: boolean, startAt: number) {
		let measured: ReadonlyMap<string, number> = new Map();
		let frozen: number | null = null;
		let estimate = estimateOf([], null).estimate;
		let from = startAt;
		const to = (): number => from + 640;
		const heights = (): Array<number | undefined> =>
			Array.from({ length: N }, (_, i) => measured.get(key(i)));
		let now = layout(windowOf(heights(), from, to(), null, estimate));
		const watched = (now.rows.find((r) => r.bottom > from) as RowBox).key;
		const offsets: number[] = [];
		const firsts: string[] = [watched];
		let passes = 0;
		for (; passes < 4 * N; passes++) {
			// Measure what is mounted.
			const next = remember(
				measured,
				now.rows.map((r) => [r.key, r.bottom - r.top] as const),
			);
			if (next === measured) break;
			measured = next;
			const e = estimateOf([...next.values()], frozen);
			if (e.frozen) frozen = e.estimate;
			estimate = e.estimate;
			// The window for the new heights, and the anchor held across it.
			const anchor = pickAnchor(now.rows, now.height, from);
			now = layout(windowOf(heights(), from, to(), null, estimate));
			if (anchored) from += anchorShift(anchor, now.rows, now.height);
			const at = now.rows.find((r) => r.key === watched);
			if (at) offsets.push(at.top - from);
			firsts.push((now.rows.find((r) => r.bottom > from) as RowBox).key);
		}
		return { passes, offsets, firsts, height: now.height };
	}

	it('settles, with the first visible row where it was in the scroller', () => {
		const r = run(true, 2900);
		expect(r.passes).toBeLessThan(4 * N);
		expect(r.offsets.length).toBeGreaterThan(1);
		const [o0] = r.offsets as [number];
		for (const o of r.offsets) expect(Math.abs(o - o0)).toBeLessThan(1e-6);
		expect(new Set(r.firsts).size).toBe(1);
	});

	it('without the anchor the rows in view are replaced as the rows above are measured', () => {
		expect(new Set(run(false, 2900).firsts).size).toBeGreaterThan(1);
	});

	it('settles at a height near the true one', () => {
		const r = run(true, 0);
		const total = TRUE.reduce((n, h) => n + h, 0);
		expect(Math.abs(r.height - total)).toBeLessThan(total * 0.2);
	});
});

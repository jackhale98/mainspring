// SPDX-License-Identifier: GPL-2.0-or-later
// What keeps the health list still while it is measured (anchor.ts): the anchor and the scroll it
// asks for, the bias that holds it while a finger scrolls, the height bookkeeping, and the whole loop
// (window, measure, anchor) on a list of rows with fractional heights, which settles with the first
// visible row where it was and, on a plain scroll down, never needs a shift.
import { describe, expect, it } from 'vitest';
import {
	anchorShift,
	nextBias,
	pickAnchor,
	remember,
	resizeShift,
	spacerOf,
	type RowBox,
} from './anchor';
import { estimateOf, windowOf, type Windowed } from './window';

const box = (key: string, top: number, h: number): RowBox => ({ key, top, bottom: top + h });

describe('pickAnchor', () => {
	const rows = [box('a', 400, 100), box('b', 500, 100), box('c', 600, 100)];

	it('is every mounted row that reaches the visible part, first to last', () => {
		expect(pickAnchor(rows, 2000, 450, 620)).toEqual({
			kind: 'rows',
			rows: [
				{ key: 'a', top: 400 },
				{ key: 'b', top: 500 },
				{ key: 'c', top: 600 },
			],
		});
		expect(pickAnchor(rows, 2000, 500, 580)).toEqual({
			kind: 'rows',
			rows: [{ key: 'b', top: 500 }],
		});
	});

	it('is nothing for a list that starts at or below the top of the scroller', () => {
		expect(pickAnchor(rows, 2000, 0, 640)).toBeNull();
		expect(pickAnchor(rows, 2000, -300, 340)).toBeNull();
	});

	it('is the list height for a list that ends above the scroller', () => {
		expect(pickAnchor(rows, 2000, 2000, 2640)).toEqual({ kind: 'end', height: 2000 });
		expect(pickAnchor(rows, 2000, 5000, 5640)).toEqual({ kind: 'end', height: 2000 });
	});

	it('is nothing when no mounted row reaches the visible part', () => {
		expect(pickAnchor(rows, 2000, 1500, 2140)).toBeNull();
	});
});

describe('anchorShift', () => {
	const anchor = pickAnchor([box('a', 400, 100), box('b', 500, 100)], 2000, 450, 640);

	it('is how far the first anchor row moved', () => {
		expect(anchorShift(anchor, [box('a', 640, 100), box('b', 740, 100)], 2400)).toBe(240);
		expect(anchorShift(anchor, [box('a', 380, 100)], 1900)).toBe(-20);
		expect(anchorShift(anchor, [box('a', 400, 100)], 2400)).toBe(0);
	});

	it('falls to the next row in view when the first is gone (a finding that was fixed)', () => {
		expect(anchorShift(anchor, [box('b', 470, 100), box('c', 570, 100)], 2000)).toBe(-30);
	});

	it('is how far the list grew, for a list above the scroller', () => {
		expect(anchorShift({ kind: 'end', height: 2000 }, [], 1650)).toBe(-350);
	});

	it('is 0 without an anchor, or when none of its rows is mounted any more', () => {
		expect(anchorShift(null, [box('a', 1, 1)], 100)).toBe(0);
		expect(anchorShift(anchor, [box('x', 1, 1)], 100)).toBe(0);
	});

	it('leaves out what a render that has not happened yet will still move', () => {
		// The row is 30 px lower, 30 of which the bias just changed will account for.
		expect(anchorShift(anchor, [box('a', 430, 100)], 2000, 30)).toBe(0);
		expect(anchorShift({ kind: 'end', height: 2000 }, [], 1970, -30)).toBe(0);
	});
});

describe('resizeShift', () => {
	it('moves the view for a row that ended above it, and not for one that did not', () => {
		expect(resizeShift([{ top: 20, was: 60, now: 224 }], 100)).toBe(164);
		expect(resizeShift([{ top: 40, was: 60, now: 40 }], 100)).toBe(-20);
		expect(resizeShift([{ top: 60, was: 60, now: 224 }], 100)).toBe(0);
	});

	it("takes a row's top from before the rows above it changed", () => {
		// Row A (top 0) grows by 100, which pushes B down to 130 (it was at 30, ending at 90, above
		// the view's top at 100). B was above the view before, so its change counts, too.
		const both = resizeShift(
			[
				{ top: 0, was: 30, now: 130 },
				{ top: 130, was: 60, now: 90 },
			],
			100,
		);
		expect(both).toBe(100 + 30);
		// Read from its top now (130 + 60 > 100) B would be taken for a row in view.
		expect(resizeShift([{ top: 130, was: 60, now: 90 }], 100)).toBe(0);
	});
});

describe('the bias', () => {
	it('holds a row that moved down by making the spacer smaller, and says how far it will move', () => {
		expect(nextBias(0, 30, 500)).toEqual({ bias: -30, owed: -30 });
		expect(nextBias(-30, -10, 500)).toEqual({ bias: -20, owed: 10 });
		expect(spacerOf(500, -30)).toBe(470);
	});

	it('cannot make the spacer negative', () => {
		expect(nextBias(0, 80, 50)).toEqual({ bias: -50, owed: -50 });
		expect(spacerOf(50, -50)).toBe(0);
		expect(spacerOf(20, -50)).toBe(0);
	});
});

describe('remember', () => {
	it('returns the same map when nothing changed, so nothing downstream runs again', () => {
		const known = new Map([['a', 100]]);
		expect(remember(known, [['a', 100]])).toBe(known);
		expect(remember(known, [['a', 100.05]])).toBe(known);
		expect(remember(known, [])).toBe(known);
	});

	it('takes a fractional height as it is, and a change of half a pixel for a change', () => {
		const known = new Map([['a', 97.5]]);
		const next = remember(known, [['a', 98]]);
		expect(next.get('a')).toBe(98);
		expect(remember(known, [['b', 19.5]]).get('b')).toBe(19.5);
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
	const VIEW = 640;
	/** Fractional, as 13 px text at a 1.5 line height is: whole and half lines of 19.5 px. */
	const TRUE = Array.from({ length: N }, (_, i) => 97.5 + ((i * 37) % 5) * 19.5);
	const key = (i: number): string => `k${i}`;

	/** What the DOM holds for a window: the spacer (with the bias), the mounted rows, the spacer. */
	function layout(w: Windowed, bias: number): { rows: RowBox[]; height: number } {
		const rows: RowBox[] = [];
		let y = spacerOf(w.before, bias);
		for (let i = w.start; i < w.end; i++) {
			rows.push(box(key(i), y, TRUE[i] as number));
			y += TRUE[i] as number;
		}
		return { rows, height: y + w.after };
	}

	/**
	 * The list as the component runs it: each flush notes the rows in view, renders the window,
	 * measures what is mounted and holds the first row in view where it was, by scrolling or by the
	 * bias. `scroll` moves the view; a flush is repeated until nothing changes.
	 */
	function list(initial: 'scroll' | 'bias' | 'none', round = false) {
		let mode = initial;
		let measured: ReadonlyMap<string, number> = new Map();
		let frozen: number | null = null;
		let estimate = estimateOf([], null).estimate;
		let from = 0;
		let bias = 0;
		let owed = 0;
		let writes = 0;
		let win = windowOf(new Array<undefined>(N).fill(undefined), 0, VIEW, null, estimate);
		let dom = layout(win, 0);
		const heights = (): Array<number | undefined> =>
			Array.from({ length: N }, (_, i) => measured.get(key(i)));
		/** One flush; the shift it needed, and whether another is due. */
		function flush(): { shift: number; more: boolean } {
			const anchor = pickAnchor(dom.rows, dom.height, from, from + VIEW);
			const rendering = owed;
			owed = 0;
			win = windowOf(heights(), from - bias, from + VIEW - bias, null, estimate);
			dom = layout(win, bias);
			const shift = anchorShift(anchor, dom.rows, dom.height, rendering);
			let more = false;
			if (Math.abs(shift) >= 0.5 && mode === 'scroll') {
				from += shift;
				writes++;
				more = true;
			} else if (Math.abs(shift) >= 0.5 && mode === 'bias') {
				const next = nextBias(bias, shift, win.before);
				if (next.bias !== bias) {
					bias = next.bias;
					owed += next.owed;
					more = true;
				}
			}
			const next = remember(
				measured,
				dom.rows.map(
					(r) => [r.key, round ? Math.round(r.bottom - r.top) : r.bottom - r.top] as const,
				),
			);
			if (next !== measured) {
				measured = next;
				const e = estimateOf([...next.values()], frozen);
				if (e.frozen) frozen = e.estimate;
				estimate = e.estimate;
				more = true;
			}
			return { shift, more };
		}
		return {
			/** The user scrolls by `by`; flushes until it is still. Returns the shifts asked for. */
			scrollBy(by: number): number[] {
				from = Math.max(0, from + by);
				const shifts: number[] = [];
				for (let i = 0; i < 4 * N; i++) {
					const r = flush();
					shifts.push(r.shift);
					if (!r.more) break;
				}
				return shifts;
			},
			/** Where the first row in view is, relative to the view's top. */
			first: (): { key: string; offset: number } => {
				const r = dom.rows.find((x) => x.bottom > from) as RowBox;
				return { key: r.key, offset: r.top - from };
			},
			/** Where a row is relative to the view's top, or NaN when it is not mounted. */
			offsetOf: (k: string): number => {
				const r = dom.rows.find((x) => x.key === k);
				return r ? r.top - from : NaN;
			},
			/** The scrolling stopped: the bias goes in a render that is held by scrolling. */
			release(): void {
				bias = 0;
				owed = 0;
				mode = 'scroll';
				for (let i = 0; i < 4 * N; i++) if (!flush().more) break;
			},
			get writes() {
				return writes;
			},
			get bias() {
				return bias;
			},
			get height() {
				return dom.height;
			},
		};
	}

	it('on a plain scroll down never needs a shift', () => {
		const l = list('scroll');
		l.scrollBy(0);
		for (let i = 0; i < 40; i++) {
			for (const s of l.scrollBy(100)) expect(Math.abs(s)).toBeLessThan(1e-6);
		}
		expect(l.writes).toBe(0);
	});

	it('with rounded heights the same scroll needs shifts: the rounding error moves the row', () => {
		const l = list('scroll', true);
		l.scrollBy(0);
		for (let i = 0; i < 40; i++) l.scrollBy(100);
		expect(l.writes).toBeGreaterThan(0);
	});

	/**
	 * Jumps ahead into rows nobody has seen, then scrolls up through them: how many steps the row that
	 * was first in view did not move down by exactly the step.
	 */
	function up(mode: 'scroll' | 'bias' | 'none') {
		const l = list(mode);
		l.scrollBy(0);
		l.scrollBy(3000);
		let violations = 0;
		for (let i = 0; i < 20; i++) {
			const before = l.first();
			l.scrollBy(-100);
			// The row that was first in view is a step lower in it, if it is still mounted.
			const at = l.offsetOf(before.key);
			if (!Number.isNaN(at) && Math.abs(at - before.offset - 100) > 1e-6) violations++;
		}
		return { l, violations };
	}

	it('scrolling up into rows that were never seen is held by scrolling', () => {
		const { l, violations } = up('scroll');
		expect(violations).toBe(0);
		expect(l.writes).toBeGreaterThan(0);
	});

	it('is held by the bias instead while a finger scrolls: no scroll write, and the release keeps it', () => {
		const { l, violations } = up('bias');
		expect(violations).toBe(0);
		expect(l.writes).toBe(0);
		expect(l.bias).not.toBe(0);
		const before = l.first();
		l.release();
		expect(l.bias).toBe(0);
		expect(l.first().key).toBe(before.key);
		expect(Math.abs(l.first().offset - before.offset)).toBeLessThan(1e-6);
	});

	it('without holding, the row in view moves as the rows above it are measured', () => {
		expect(up('none').violations).toBeGreaterThan(0);
	});

	it('settles at a height near the true one', () => {
		const l = list('scroll');
		l.scrollBy(0);
		for (let i = 0; i < 80; i++) l.scrollBy(300);
		const total = TRUE.reduce((n, h) => n + h, 0);
		expect(Math.abs(l.height - total)).toBeLessThan(total * 0.2);
	});
});

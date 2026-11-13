// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { roundSnap, snapDelta, snapperFromWorkingTime, type WorkingDayBounds } from './snap';

/**
 * A stub of the working-time module (T4): Monday to Friday, 09:00 to 17:00, minute 0 is a Monday
 * at midnight. It follows the documented semantics of `WorkingTime.dayStart` and `dayEnd`.
 */
const DAY = 1440;
const OPEN = 540;
const CLOSE = 1020;
const working = (d: number): boolean => ((d % 7) + 7) % 7 < 5;

const stub: WorkingDayBounds = {
	dayStart(m) {
		for (let d = Math.floor(m / DAY); ; d++) {
			if (working(d) && m < d * DAY + CLOSE) return d * DAY + OPEN;
		}
	},
	dayEnd(m) {
		for (let d = Math.floor(m / DAY); ; d--) {
			if (working(d) && m >= d * DAY + OPEN) return d * DAY + CLOSE;
		}
	},
};
const snap = snapperFromWorkingTime(stub);

const mon = (h: number, min = 0) => h * 60 + min;
const day = (n: number, h: number, min = 0) => n * DAY + mon(h, min);

describe('snapperFromWorkingTime', () => {
	it.each([
		['inside a day, before its middle: this day start', day(0, 10), day(0, 9)],
		['an exact start stays', day(1, 9), day(1, 9)],
		['at the end of the day: this day start is still nearer than tomorrow', day(0, 17), day(0, 9)],
		['off hours in the evening: the next day', day(0, 22), day(1, 9)],
		['off hours in the small hours: the coming day', day(1, 3), day(1, 9)],
		[
			'Friday evening: Monday after the weekend is farther than Friday itself',
			day(4, 18),
			day(4, 9),
		],
		['Saturday noon: Friday is nearer than Monday', day(5, 12), day(4, 9)],
		['Sunday evening: Monday is nearer', day(6, 20), day(7, 9)],
	])('start: %s', (_name, m, want) => {
		expect(snap(m, 'start')).toBe(want);
	});

	it.each([
		['inside a day, late: this day end', day(0, 15), day(0, 17)],
		['an exact end stays', day(0, 17), day(0, 17)],
		['small hours: yesterday end is nearer', day(1, 4), day(0, 17)],
		['off hours in the evening: this day end', day(0, 18), day(0, 17)],
		['Saturday noon: Friday end', day(5, 12), day(4, 17)],
		['Sunday night: Monday end is nearer than Friday', day(6, 23), day(7, 17)],
	])('end: %s', (_name, m, want) => {
		expect(snap(m, 'end')).toBe(want);
	});

	it('rounds fractional minutes first', () => {
		expect(snap(day(0, 10) + 0.4, 'start')).toBe(day(0, 9));
	});

	it('is idempotent and lands on a boundary of its role, never farther than the floor candidate', () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 40 * DAY }), (m) => {
				const s = snap(m, 'start');
				expect(stub.dayStart(s)).toBe(s);
				expect(snap(s, 'start')).toBe(s);
				expect(Math.abs(s - m)).toBeLessThanOrEqual(Math.abs(stub.dayStart(m) - m));
				const e = snap(m, 'end');
				expect(stub.dayEnd(e)).toBe(e);
				expect(snap(e, 'end')).toBe(e);
				expect(Math.abs(e - m)).toBeLessThanOrEqual(Math.abs(stub.dayEnd(m) - m));
			}),
		);
	});
});

describe('snapDelta', () => {
	it('moves the edge, not the pointer', () => {
		// A start on Monday 09:00, dragged by a day and a bit.
		expect(snapDelta(snap, day(0, 9), DAY + 90, 'start')).toEqual({
			deltaMin: DAY,
			snappedMin: day(1, 9),
		});
	});
	it('gives a zero delta for a small drag, and a negative delta for a drag back', () => {
		expect(snapDelta(snap, day(1, 9), 60, 'start').deltaMin).toBe(0);
		expect(snapDelta(snap, day(2, 9), -DAY, 'start').deltaMin).toBe(-DAY);
	});
	it('skips the weekend when the drag lands on it', () => {
		expect(snapDelta(snap, day(4, 9), 3 * DAY, 'start').snappedMin).toBe(day(7, 9));
	});
	it('with the round snap, passes the movement through', () => {
		expect(snapDelta(roundSnap, 100, 37.4, 'end')).toEqual({ deltaMin: 37, snappedMin: 137 });
	});
});

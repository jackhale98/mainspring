// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	calendarDragSnapper,
	dragSnapperFromWorkingDays,
	nearestBoundary,
	snapMoveDays,
	type DayRole,
	type WorkingDays,
} from './snap';

/**
 * A stub that mirrors the semantics of T4's `schedule/working-time.ts` (read from its in-progress
 * branch): working days are local calendar days that hold working time (here Monday to Friday,
 * 09:00 to 17:00, over 8 weeks, minute 0 a Monday midnight, UTC). A start belongs to the day that
 * holds it, an end to the day of the minute before it. `shiftDays` walks the day list from that
 * day by `by`, clamping at both ends, and returns the day's first or last working minute.
 * The adapter must be retested against the real module when T4 merges.
 */
const DAY = 1440;
const OPEN = 540;
const CLOSE = 1020;
const DAYS: Array<{ key: number; start: number; end: number }> = [];
for (let d = 0; d < 56; d++) {
	if (d % 7 < 5) DAYS.push({ key: d, start: d * DAY + OPEN, end: d * DAY + CLOSE });
}
const keyOf = (m: number): number => Math.floor(m / DAY);
const firstAtOrAfter = (k: number): number => {
	const i = DAYS.findIndex((d) => d.key >= k);
	return i < 0 ? DAYS.length : i;
};
const lastAtOrBefore = (k: number): number => {
	let at = -1;
	DAYS.forEach((d, i) => {
		if (d.key <= k) at = i;
	});
	return at;
};
const stub: WorkingDays & { dayStart(m: number): number; dayEnd(m: number): number } = {
	dayStart(m) {
		const i = firstAtOrAfter(keyOf(m));
		return DAYS[i]?.start ?? m;
	},
	dayEnd(m) {
		const i = lastAtOrBefore(keyOf(m - 1));
		return DAYS[i]?.end ?? m;
	},
	shiftDays(m, by, role: DayRole) {
		const at = role === 'start' ? firstAtOrAfter(keyOf(m)) : lastAtOrBefore(keyOf(m - 1));
		const i = Math.max(0, Math.min(DAYS.length - 1, at + Math.trunc(by)));
		const day = DAYS[i];
		return (role === 'start' ? day?.start : day?.end) ?? m;
	},
};

const at = (day: number, h: number, min = 0): number => day * DAY + h * 60 + min;
const MON = 0;
const TUE = 1;
const WED = 2;
const THU = 3;
const FRI = 4;
const SAT = 5;
const SUN = 6;
const snapper = dragSnapperFromWorkingDays(stub);

describe('the stub is T4 (calendar days, not working hours)', () => {
	it('dayStart of Monday 22:00 is Monday 09:00, and dayEnd of Monday 08:00 is Friday before', () => {
		expect(stub.dayStart(at(MON, 22))).toBe(at(MON, 9));
		expect(stub.dayStart(at(SAT, 12))).toBe(at(7, 9));
		expect(stub.shiftDays(at(WED, 13), 0, 'start')).toBe(at(WED, 9));
		expect(stub.shiftDays(at(WED, 13), 1, 'start')).toBe(at(THU, 9));
		expect(stub.shiftDays(at(WED, 13), 0, 'end')).toBe(at(WED, 17));
		expect(stub.shiftDays(at(WED, 17), 0, 'end')).toBe(at(WED, 17));
	});
});

describe('nearestBoundary', () => {
	it.each<[string, number, DayRole, number]>([
		['Monday 10:00 start: Monday', at(MON, 10), 'start', at(MON, 9)],
		['an exact start stays', at(TUE, 9), 'start', at(TUE, 9)],
		['Monday 22:00 start: Tuesday is nearer', at(MON, 22), 'start', at(TUE, 9)],
		['Tuesday 03:00 start: Tuesday', at(TUE, 3), 'start', at(TUE, 9)],
		['Saturday noon start: Friday is nearer than Monday', at(SAT, 12), 'start', at(FRI, 9)],
		['Sunday evening start: Monday is nearer', at(SUN, 20), 'start', at(7, 9)],
		['Wednesday 15:00 end: Wednesday', at(WED, 15), 'end', at(WED, 17)],
		['an exact end stays', at(WED, 17), 'end', at(WED, 17)],
		['Wednesday 04:00 end: Tuesday is nearer', at(WED, 4), 'end', at(TUE, 17)],
		['Wednesday 18:00 end: Wednesday', at(WED, 18), 'end', at(WED, 17)],
		['Saturday noon end: Friday', at(SAT, 12), 'end', at(FRI, 17)],
		['Sunday night end: Monday is nearer than Friday', at(SUN, 23), 'end', at(7, 17)],
	])('%s', (_name, m, role, want) => {
		expect(nearestBoundary(stub, m, role)).toBe(want);
	});

	it('is symmetric: mirroring the time around two boundaries picks the mirrored one', () => {
		// Halfway between Tuesday 17:00 and Wednesday 17:00 is Wednesday 05:00: the tie goes later.
		expect(nearestBoundary(stub, at(WED, 5), 'end')).toBe(at(WED, 17));
		expect(nearestBoundary(stub, at(WED, 5) - 1, 'end')).toBe(at(TUE, 17));
	});

	it('is idempotent and lands on a boundary', () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 54 * DAY }), (m) => {
				for (const role of ['start', 'end'] as const) {
					const s = nearestBoundary(stub, m, role);
					expect(stub.shiftDays(s, 0, role)).toBe(s);
					expect(nearestBoundary(stub, s, role)).toBe(s);
				}
			}),
		);
	});
});

describe('move: whole working days from the original edge (6.6)', () => {
	it('a task starting Wednesday 13:00 does not move against the drag (the review examples)', () => {
		const ref = at(WED, 13);
		expect(snapper.move(ref, 0.3 * DAY)).toEqual({ days: 0, deltaMin: 0, snappedMin: ref });
		expect(snapper.move(ref, -0.3 * DAY)).toEqual({ days: 0, deltaMin: 0, snappedMin: ref });
		expect(snapper.move(ref, 0.6 * DAY)).toEqual({
			days: 1,
			deltaMin: at(THU, 9) - ref,
			snappedMin: at(THU, 9),
		});
		expect(snapper.move(ref, -0.9 * DAY)).toEqual({
			days: -1,
			deltaMin: at(TUE, 9) - ref,
			snappedMin: at(TUE, 9),
		});
	});

	it('counts working days across a weekend', () => {
		const fri = at(FRI, 9);
		expect(snapMoveDays(stub, fri, 3 * DAY)).toBe(1); // Monday
		expect(snapMoveDays(stub, fri, 4 * DAY)).toBe(2);
		expect(snapMoveDays(stub, fri, 1 * DAY)).toBe(0); // Saturday: Friday is nearer than Monday
		expect(snapMoveDays(stub, fri, 1.5 * DAY)).toBe(1); // the tie goes later
		expect(snapMoveDays(stub, at(7, 9), -3 * DAY)).toBe(-1); // Monday back to Friday
		expect(snapMoveDays(stub, fri, 14 * DAY)).toBe(10);
	});

	it('clamps at the end of the frame and reports the days that actually move it', () => {
		const lastMonday = at(49, 9);
		const m = snapper.move(lastMonday, 30 * DAY);
		expect(m.days).toBe(4);
		expect(m.snappedMin).toBe(at(53, 9));
		expect(snapper.move(at(1, 9), -30 * DAY).days).toBe(-1);
	});

	it('never moves against the pointer, and zero days is no change at all', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 2 * DAY, max: 40 * DAY }),
				fc.integer({ min: -9 * DAY, max: 9 * DAY }),
				(ref, raw) => {
					const m = snapper.move(ref, raw);
					if (raw > 0) expect(m.deltaMin).toBeGreaterThanOrEqual(0);
					if (raw < 0) expect(m.deltaMin).toBeLessThanOrEqual(0);
					if (m.days === 0) expect(m.deltaMin).toBe(0);
					expect(Number.isInteger(m.days)).toBe(true);
				},
			),
		);
	});

	it('is monotonic: a longer drag in the same direction never moves fewer days', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 2 * DAY, max: 30 * DAY }),
				fc.integer({ min: 0, max: 8 * DAY }),
				fc.integer({ min: 0, max: 2 * DAY }),
				(ref, raw, more) => {
					expect(snapMoveDays(stub, ref, raw + more)).toBeGreaterThanOrEqual(
						snapMoveDays(stub, ref, raw),
					);
				},
			),
		);
	});
});

describe('resize: the nearest working-day end, never on the wrong side', () => {
	const ref = at(WED, 13);
	it('the Wednesday 13:00 end examples', () => {
		expect(snapper.resize(ref, 0.3 * DAY)).toEqual({
			deltaMin: at(WED, 17) - ref,
			snappedMin: at(WED, 17),
		});
		// Wednesday 17:00 is nearer than Tuesday 17:00, but it is to the right of a leftward drag.
		expect(snapper.resize(ref, -0.3 * DAY)).toEqual({ deltaMin: 0, snappedMin: ref });
		expect(snapper.resize(ref, -0.8 * DAY)).toEqual({
			deltaMin: at(TUE, 17) - ref,
			snappedMin: at(TUE, 17),
		});
		expect(snapper.resize(ref, 1.2 * DAY).snappedMin).toBe(at(THU, 17));
	});

	it('no movement is no change', () => {
		expect(snapper.resize(ref, 0)).toEqual({ deltaMin: 0, snappedMin: ref });
	});

	it('lands on the original end or a working-day end, on the pointer side', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 2 * DAY, max: 40 * DAY }),
				fc.integer({ min: -9 * DAY, max: 9 * DAY }),
				(r, raw) => {
					const s = snapper.resize(r, raw);
					if (raw > 0) expect(s.snappedMin).toBeGreaterThanOrEqual(r);
					if (raw < 0) expect(s.snappedMin).toBeLessThanOrEqual(r);
					expect(
						s.snappedMin === r || stub.shiftDays(s.snappedMin, 0, 'end') === s.snappedMin,
					).toBe(true);
					expect(s.deltaMin).toBe(s.snappedMin - r);
				},
			),
		);
	});
});

describe('calendarDragSnapper', () => {
	it('moves whole calendar days and resizes by whole minutes', () => {
		const s = calendarDragSnapper();
		expect(s.move(100, 1.6 * DAY)).toEqual({
			days: 2,
			deltaMin: 2 * DAY,
			snappedMin: 100 + 2 * DAY,
		});
		expect(s.move(100, 10)).toEqual({ days: 0, deltaMin: 0, snappedMin: 100 });
		expect(s.resize(100, 37.4)).toEqual({ deltaMin: 37, snappedMin: 137 });
	});
});

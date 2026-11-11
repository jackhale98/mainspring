// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	civilFromDays,
	daysFromCivil,
	epochToLocal,
	fieldsFromUtc,
	isLeapYear,
	lastDayOfMonth,
	localToEpoch,
	sameTimeNextDay,
	utcSeconds,
	weekdayOf,
	type ZoneOffsets,
} from './civil';

const f = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) => ({
	year,
	month,
	day,
	hour,
	minute,
	second,
});
/** Europe/Berlin for 2026: CET, CEST from 2026-03-29 01:00 UTC to 2026-10-25 01:00 UTC. */
const DST = [utcSeconds(f(2026, 3, 29, 1)), utcSeconds(f(2026, 10, 25, 1))] as const;
const berlin: ZoneOffsets = { offset: (_zone, e) => (e >= DST[0] && e < DST[1] ? 7200 : 3600) };
const env = { zone: 'Europe/Berlin', zones: berlin };

describe('civil arithmetic', () => {
	it('matches known epochs', () => {
		expect(daysFromCivil(1970, 1, 1)).toBe(0);
		expect(utcSeconds(f(2026, 1, 5, 9))).toBe(1767603600);
		expect(utcSeconds(f(2000, 1, 1))).toBe(946684800);
		expect(civilFromDays(daysFromCivil(2028, 2, 29))).toEqual({ year: 2028, month: 2, day: 29 });
	});

	it('rolls days past the month end as Time.utc does', () => {
		expect(fieldsFromUtc(utcSeconds(f(2026, 2, 30)))).toEqual(f(2026, 3, 2));
		expect(fieldsFromUtc(utcSeconds(f(2026, 4, 31)))).toEqual(f(2026, 5, 1));
		expect(fieldsFromUtc(utcSeconds(f(2028, 2, 30)))).toEqual(f(2028, 3, 1));
	});

	it('round-trips every day from 1970 to 2035', () => {
		for (let d = 0; d < daysFromCivil(2036, 1, 1); d += 1) {
			const c = civilFromDays(d);
			if (daysFromCivil(c.year, c.month, c.day) !== d) throw new Error(`day ${d}`);
		}
	});

	it('knows leap years and weekdays', () => {
		expect([2000, 2024, 2100, 2026].map(isLeapYear)).toEqual([true, true, false, false]);
		expect(lastDayOfMonth(2, 2028)).toBe(29);
		expect(weekdayOf(utcSeconds(f(2026, 1, 5)))).toBe(1); // a Monday
		expect(weekdayOf(0)).toBe(4); // 1970-01-01 was a Thursday
	});
});

describe('local time', () => {
	it('is UTC without a zone and for UTC', () => {
		expect(localToEpoch(f(2026, 1, 5, 9), { zone: null })).toBe(1767603600);
		expect(localToEpoch(f(2026, 1, 5, 9), { zone: 'UTC' })).toBe(1767603600);
	});

	it('needs zone data for other zones', () => {
		expect(localToEpoch(f(2026, 1, 5, 9), { zone: 'Europe/Berlin' })).toBeNull();
		expect(epochToLocal(0, { zone: 'Europe/Berlin' })).toBeNull();
	});

	it('follows the bridge patch: two offset lookups', () => {
		expect(localToEpoch(f(2026, 1, 5, 9), env)).toBe(1767603600 - 3600);
		expect(localToEpoch(f(2026, 7, 6, 9), env)).toBe(utcSeconds(f(2026, 7, 6, 7)));
		// 02:30 on 2026-03-29 does not exist in Berlin; the patch lands on 01:30 UTC (03:30 CEST).
		expect(localToEpoch(f(2026, 3, 29, 2, 30), env)).toBe(utcSeconds(f(2026, 3, 29, 1, 30)));
		// 02:30 on 2026-10-25 happens twice; the patch picks the later one (CET).
		expect(localToEpoch(f(2026, 10, 25, 2, 30), env)).toBe(utcSeconds(f(2026, 10, 25, 1, 30)));
	});

	it('reads local fields back', () => {
		expect(epochToLocal(utcSeconds(f(2026, 7, 6, 7)), env)).toEqual(f(2026, 7, 6, 9));
	});

	it('moves to the same wall time on the next day across a DST change', () => {
		const start = localToEpoch(f(2026, 3, 28, 9), env) ?? 0;
		const next = sameTimeNextDay(start, env) ?? 0;
		expect(next - start).toBe(23 * 3600);
		expect(epochToLocal(next, env)).toEqual(f(2026, 3, 29, 9));
		expect(sameTimeNextDay(utcSeconds(f(2026, 12, 31)), { zone: null })).toBe(
			utcSeconds(f(2027, 1, 1)),
		);
		expect(sameTimeNextDay(0, { zone: 'Europe/Berlin' })).toBeNull();
	});
});

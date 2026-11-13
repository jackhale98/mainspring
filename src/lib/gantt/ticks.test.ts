// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../engine/timezone';
import {
	dayLabel,
	dayOf,
	formatMinutes,
	midnightOf,
	tickLevel,
	ticksFor,
	weekdayOfDay,
	type GanttCalendar,
} from './ticks';
import { MIN_PER_DAY } from './scale';

// Monday 2026-01-05 00:00 UTC.
const START = Date.UTC(2026, 0, 5) / 1000;
const utc: GanttCalendar = { startEpoch: START, env: { zone: null }, locale: 'en-US' };
const berlin: GanttCalendar = {
	startEpoch: Date.UTC(2026, 2, 27) / 1000 - 3600,
	env: { zone: 'Europe/Berlin', zones: createTimeZoneHost() },
	locale: 'en-US',
};

describe('tickLevel', () => {
	it('picks the header granularity from the zoom', () => {
		expect(tickLevel(56)).toBe('day');
		expect(tickLevel(16)).toBe('week');
		expect(tickLevel(4.5)).toBe('month');
		expect(tickLevel(1.2)).toBe('quarter');
	});
});

describe('days and labels', () => {
	it('finds the calendar day of a minute and the midnight it starts at', () => {
		const day0 = dayOf(utc, 0);
		expect(weekdayOfDay(day0)).toBe(1);
		expect(dayOf(utc, 1439)).toBe(day0);
		expect(dayOf(utc, 1440)).toBe(day0 + 1);
		expect(midnightOf(utc, day0 + 2)).toBe(2 * MIN_PER_DAY);
		expect(midnightOf(utc, day0 - 1)).toBe(-MIN_PER_DAY);
	});

	it('writes dates with Intl from the project calendar, not the viewer zone', () => {
		expect(dayLabel(utc, dayOf(utc, 0), 'weekday-day')).toBe('Mon 5');
		expect(formatMinutes(utc, 0, 'month-day')).toBe('Jan 5');
		expect(formatMinutes(utc, 0)).toContain('2026');
	});
});

describe('ticksFor', () => {
	it('gives days under months at day zoom, aligned to midnight', () => {
		const t = ticksFor(utc, 0, 10 * MIN_PER_DAY, 56);
		expect(t.level).toBe('day');
		expect(t.minor).toHaveLength(10);
		expect(t.minor[0]).toMatchObject({ at: 0, end: MIN_PER_DAY, label: 'Mon 5' });
		expect(t.major.map((c) => c.label)).toEqual(['January 2026']);
		// The month cell starts before the range: January 1.
		expect(t.major[0]?.at).toBe(-4 * MIN_PER_DAY);
		expect(t.major[0]?.end).toBe(27 * MIN_PER_DAY);
	});

	it('starts week cells on Monday', () => {
		const t = ticksFor(utc, 3 * MIN_PER_DAY, 20 * MIN_PER_DAY, 16);
		expect(t.level).toBe('week');
		expect(t.minor.map((c) => [c.at / MIN_PER_DAY, c.label])).toEqual([
			[0, 'Jan 5'],
			[7, 'Jan 12'],
			[14, 'Jan 19'],
		]);
	});

	it('gives months under years, then quarters under years', () => {
		const m = ticksFor(utc, 0, 400 * MIN_PER_DAY, 4.5);
		expect(m.minor.slice(0, 3).map((c) => c.label)).toEqual(['Jan', 'Feb', 'Mar']);
		expect(m.major.map((c) => c.label)).toEqual(['2026', '2027']);
		const q = ticksFor(utc, 0, 400 * MIN_PER_DAY, 1.2);
		expect(q.minor.map((c) => c.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q1']);
	});

	it('covers the range without gaps and without cells beyond it', () => {
		for (const px of [56, 16, 4.5, 1.2]) {
			const t = ticksFor(utc, 100, 900 * MIN_PER_DAY, px);
			for (const row of [t.major, t.minor]) {
				expect(row[0]?.at).toBeLessThanOrEqual(100);
				expect(row[row.length - 1]?.end).toBeGreaterThanOrEqual(900 * MIN_PER_DAY);
				row.slice(1).forEach((c, i) => expect(c.at).toBe(row[i]?.end));
			}
		}
	});

	it('makes the day of a clock change 23 hours long in the project zone', () => {
		// Berlin springs forward on Sunday 2026-03-29.
		const day = dayOf(berlin, 0) + 2;
		expect(weekdayOfDay(day)).toBe(0);
		const t = ticksFor(berlin, midnightOf(berlin, day), midnightOf(berlin, day) + 1, 56);
		expect(t.minor).toHaveLength(1);
		expect((t.minor[0]?.end ?? 0) - (t.minor[0]?.at ?? 0)).toBe(23 * 60);
	});

	it('stays bounded for an absurd range', () => {
		const t = ticksFor(utc, 0, 5_000_000 * MIN_PER_DAY, 56);
		expect(t.minor.length).toBeLessThanOrEqual(2000);
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../../engine/runtime';
import { utcSeconds } from './civil';
import { projectContext } from './context';
import {
	dateFromEpoch,
	epochAt,
	minutesSince,
	parseDate,
	printDate,
	printTjDate,
	resolveDate,
	resolveProjectDate,
	sameDate,
	type DateExpr,
	type TjDate,
} from './date';
import { int } from './number';

const zones = createTimeZoneHost();
const date = (text: string): DateExpr => {
	const r = parseDate(text);
	if (!r.ok) throw new Error(`${text}: ${r.error.code}`);
	return r.value;
};
const tj = (
	y: number,
	mo: number,
	d: number,
	h = 0,
	mi = 0,
	s = 0,
	zone: number | null = null,
): TjDate => ({
	year: y,
	month: mo,
	day: d,
	hour: h,
	minute: mi,
	second: s,
	zone,
});
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) =>
	utcSeconds({ year: y, month: mo, day: d, hour: h, minute: mi, second: 0 });
const errorOf = (text: string) => {
	const r = parseDate(text);
	if (r.ok) throw new Error(`${text} parsed`);
	return r.error;
};

describe('parseDate', () => {
	it('reads every DATE form', () => {
		expect(date('2026-01-05')).toEqual({ kind: 'date', date: tj(2026, 1, 5) });
		expect(date('2026-1-5')).toEqual({ kind: 'date', date: tj(2026, 1, 5) });
		expect(date('2026-01-05-09:30')).toEqual({ kind: 'date', date: tj(2026, 1, 5, 9, 30) });
		expect(date('2026-01-05-9:5')).toEqual({ kind: 'date', date: tj(2026, 1, 5, 9, 5) });
		expect(date('2026-01-05-09:30:15')).toEqual({ kind: 'date', date: tj(2026, 1, 5, 9, 30, 15) });
		expect(date('2026-01-05-09:00-+0000')).toEqual({
			kind: 'date',
			date: tj(2026, 1, 5, 9, 0, 0, 0),
		});
		expect(date('2026-01-05-09:00--0530')).toEqual({
			kind: 'date',
			date: tj(2026, 1, 5, 9, 0, 0, -330),
		});
		expect(date('2026-01-05-09:00:01-+1400')).toEqual({
			kind: 'date',
			date: tj(2026, 1, 5, 9, 0, 1, 840),
		});
	});

	it("applies TjTime#parse's checks", () => {
		expect(errorOf('1969-12-31')).toMatchObject({
			code: 'year-range',
			tj: 'time_error',
			from: 0,
			to: 10,
		});
		expect(errorOf('2036-01-01').code).toBe('year-range');
		expect(errorOf('2026-13-01').code).toBe('month-range');
		expect(errorOf('2026-00-01').code).toBe('month-range');
		expect(errorOf('2026-01-01-24:00').code).toBe('hour-range');
		expect(errorOf('2026-01-01-09:60').code).toBe('minute-range');
		expect(errorOf('2026-01-01-09:00:60').code).toBe('second-range');
		expect(errorOf('2026-01-01-09:00-0100').code).toBe('zone-sign');
		expect(errorOf('2026-01-01-09:00-+0160').code).toBe('zone-range');
		expect(errorOf('2026-01-01-09:00--1300').code).toBe('zone-range');
		expect(errorOf('2026-01-01-09:00-+1401').code).toBe('zone-range');
	});

	it('accepts days 29 to 31 in any month, as Time.mktime rolls them over', () => {
		expect(date('2026-02-30')).toEqual({ kind: 'date', date: tj(2026, 2, 30) });
		expect(resolveDate(date('2026-02-30'), projectContext({}))).toEqual({
			ok: true,
			value: utc(2026, 3, 2),
		});
		expect(errorOf('2026-02-00').code).toBe('day-range');
		expect(errorOf('2026-02-32').code).toBe('day-range');
	});

	it('reads %{} expressions with whitespace and comments between tokens', () => {
		expect(date('%{2026-01-05 + 2w}')).toEqual({
			kind: 'calc',
			base: tj(2026, 1, 5),
			sign: '+',
			duration: { amount: int(2), unit: 'w' },
		});
		expect(date('% { 2026-01-05-9:00 # c\n -8h }')).toMatchObject({ kind: 'calc', sign: '-' });
		expect(errorOf('%{2026-01-05 * 2w}').code).toBe('unexpected-token');
		expect(errorOf('%{2026-01-05 + 2w').code).toBe('unexpected-end');
		expect(errorOf('%{${now} - 2w}').code).toBe('macro-call');
	});

	it('reports errors at file offsets', () => {
		expect(parseDate('x', 40)).toMatchObject({
			ok: false,
			error: { code: 'unexpected-token', from: 40, to: 41 },
		});
		expect(parseDate('2026-01-05 x', 40)).toMatchObject({
			ok: false,
			error: { code: 'trailing-text', from: 51 },
		});
	});
});

describe('printDate', () => {
	it('writes the shortest canonical form', () => {
		expect(printTjDate(tj(2026, 1, 5))).toEqual({ ok: true, value: '2026-01-05' });
		expect(printTjDate(tj(2026, 1, 5, 9))).toEqual({ ok: true, value: '2026-01-05-09:00' });
		expect(printTjDate(tj(2026, 1, 5, 9, 0, 5))).toEqual({
			ok: true,
			value: '2026-01-05-09:00:05',
		});
		expect(printTjDate(tj(2026, 1, 5, 0, 0, 0, 0))).toEqual({
			ok: true,
			value: '2026-01-05-00:00-+0000',
		});
		expect(printTjDate(tj(2026, 1, 5, 9, 0, 0, -330))).toEqual({
			ok: true,
			value: '2026-01-05-09:00--0530',
		});
		expect(printDate(date('%{ 2026-1-5 - 1.5d }'))).toEqual({
			ok: true,
			value: '%{2026-01-05 - 1.5d}',
		});
	});

	it('refuses fields TaskJuggler would not read', () => {
		expect(printTjDate(tj(2036, 1, 1)).ok).toBe(false);
		expect(printTjDate(tj(2026, 1, 1, 24)).ok).toBe(false);
		expect(printTjDate(tj(2026, 1, 1, 9, 0, 0, 900)).ok).toBe(false);
	});

	it('keeps spelling differences equal', () => {
		expect(sameDate(date('2026-1-5'), date('2026-01-05-00:00'))).toBe(true);
		expect(sameDate(date('2026-01-05'), date('2026-01-05-00:00-+0000'))).toBe(false);
	});
});

describe('resolveDate', () => {
	const ctx = projectContext({});
	it('reads dates without a zone as UTC before any timezone statement', () => {
		expect(resolveDate(date('2026-01-05-09:00'), ctx)).toEqual({
			ok: true,
			value: utc(2026, 1, 5, 9),
		});
	});

	it('honours an explicit zone', () => {
		expect(resolveDate(date('2026-01-05-09:00-+0100'), ctx)).toEqual({
			ok: true,
			value: utc(2026, 1, 5, 8),
		});
		expect(resolveDate(date('2026-01-05-09:00--0500'), ctx)).toEqual({
			ok: true,
			value: utc(2026, 1, 5, 14),
		});
	});

	it('reads dates without a zone in the project zone', () => {
		const berlin = projectContext({ zone: 'Europe/Berlin', zones });
		expect(resolveDate(date('2026-03-20-09:00'), berlin)).toEqual({
			ok: true,
			value: utc(2026, 3, 20, 8),
		});
		expect(resolveDate(date('2026-07-06-09:00'), berlin)).toEqual({
			ok: true,
			value: utc(2026, 7, 6, 7),
		});
		expect(
			resolveDate(date('2026-03-20'), projectContext({ zone: 'Europe/Berlin' })),
		).toMatchObject({
			ok: false,
			error: { code: 'zone-data' },
		});
	});

	it('evaluates %{} with interval durations', () => {
		expect(resolveDate(date('%{2026-01-05 + 2w}'), ctx)).toEqual({
			ok: true,
			value: utc(2026, 1, 19),
		});
		expect(resolveDate(date('%{2026-01-05 - 1d}'), ctx)).toEqual({
			ok: true,
			value: utc(2026, 1, 4),
		});
		expect(resolveDate(date('%{2026-01-05 + 0d}'), ctx)).toMatchObject({
			ok: false,
			error: { tj: 'zero_duration' },
		});
	});

	it('checks the timing resolution', () => {
		expect(resolveDate(date('2026-01-05-09:30'), ctx)).toMatchObject({
			ok: false,
			error: { tj: 'misaligned_date' },
		});
		const q = projectContext({ granularity: 900 });
		expect(resolveDate(date('2026-01-05-09:30'), q).ok).toBe(true);
		expect(resolveDate(date('2026-01-05-09:00:30'), q).ok).toBe(false);
	});

	it('checks the project frame for valDate keywords', () => {
		const framed = projectContext({ start: utc(2026, 1, 5), end: utc(2026, 3, 1) });
		expect(resolveProjectDate(date('2026-03-01'), framed).ok).toBe(true);
		expect(resolveProjectDate(date('2026-03-02'), framed)).toMatchObject({
			ok: false,
			error: { tj: 'date_in_range' },
		});
	});
});

describe('dateFromEpoch and minutes', () => {
	const berlin = { zone: 'Europe/Berlin', zones };
	it('writes local time in the project zone', () => {
		expect(dateFromEpoch(utc(2026, 7, 6, 7), berlin)).toEqual(tj(2026, 7, 6, 9));
		expect(dateFromEpoch(utc(2026, 7, 6, 7), { zone: null })).toEqual(tj(2026, 7, 6, 7));
	});

	it('adds an explicit offset when local time names another instant', () => {
		// 00:30 UTC on 2026-10-25 is 02:30 CEST; local 02:30 alone would read as CET.
		expect(dateFromEpoch(utc(2026, 10, 25, 0, 30), berlin)).toEqual(
			tj(2026, 10, 25, 2, 30, 0, 120),
		);
	});

	it('converts between instants and view minutes', () => {
		const start = utc(2026, 3, 2);
		expect(minutesSince(utc(2026, 3, 3, 9), start)).toBe(33 * 60);
		expect(epochAt(33 * 60, start)).toBe(utc(2026, 3, 3, 9));
	});
});

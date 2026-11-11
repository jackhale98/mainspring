// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_WEEK,
	applyWorkingHours,
	parseTimeOfDay,
	parseWorkingHours,
	printDays,
	printTimeOfDay,
	printWorkingHours,
	sameWorkingHours,
	weeklyWorkingHours,
	workingHoursFrom,
	type WorkingHours,
} from './workinghours';

const wh = (text: string): WorkingHours => {
	const r = parseWorkingHours(text);
	if (!r.ok) throw new Error(`${text}: ${r.error.code}`);
	return r.value;
};
const errorOf = (text: string) => {
	const r = parseWorkingHours(text);
	if (r.ok) throw new Error(`${text} parsed`);
	return r.error;
};

describe('parseWorkingHours', () => {
	it('reads day ranges, lists and time intervals', () => {
		expect(wh('mon - fri 9:00 - 12:00, 13:00 - 18:00')).toEqual({
			days: ['mon', 'tue', 'wed', 'thu', 'fri'],
			hours: [
				[540, 720],
				[780, 1080],
			],
		});
		expect(wh('mon-thu 9:00-17:00').days).toEqual(['mon', 'tue', 'wed', 'thu']);
		expect(wh('mon,fri 9:00 - 12:00').days).toEqual(['mon', 'fri']);
		expect(wh('mon-sun 0:00 - 24:00')).toEqual({
			days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
			hours: [[0, 1440]],
		});
	});

	it('wraps day ranges around the week', () => {
		expect(wh('sat - mon 9:00 - 13:00').days).toEqual(['mon', 'sat', 'sun']);
		expect(wh('fri - fri off').days).toEqual(['fri']);
	});

	it('reads off as no hours', () => {
		expect(wh('sat, sun off')).toEqual({ days: ['sat', 'sun'], hours: [] });
	});

	it('reads minutes past 59 as the scanner does', () => {
		expect(wh('mon 9:75 - 12:00').hours).toEqual([[615, 720]]);
		expect(parseTimeOfDay('24:00')).toMatchObject({ ok: true, value: 1440 });
	});

	it('reports TaskJuggler errors at the right place', () => {
		expect(errorOf('mon 25:00 - 26:00')).toMatchObject({
			code: 'hour-range',
			tj: 'time_bad_hour',
			from: 4,
			to: 9,
		});
		expect(errorOf('mon 9:00 - 24:30')).toMatchObject({ code: 'time-range', tj: 'time_bad_time' });
		expect(errorOf('mon 12:00 - 9:00')).toMatchObject({
			code: 'time-interval',
			tj: 'time_interval',
			from: 4,
			to: 16,
		});
		expect(errorOf('mon 23:00 - 23:99')).toMatchObject({
			code: 'time-range',
			tj: 'bad_workinghours',
		});
		expect(errorOf('monday 9:00 - 12:00').code).toBe('unexpected-token');
		expect(errorOf('mon, 9:00 - 12:00').code).toBe('unexpected-token');
		expect(errorOf('mon').code).toBe('unexpected-end');
		expect(errorOf('mon 9:00 - 12:00,').code).toBe('unexpected-end');
	});

	it('gives the day and hour spans', () => {
		expect(parseWorkingHours('mon - fri  9:00 - 17:00', 5)).toMatchObject({
			days: { from: 5, to: 14 },
			hours: { from: 16, to: 28 },
		});
	});
});

describe('printWorkingHours', () => {
	it('writes runs of three or more as ranges', () => {
		expect(printWorkingHours(wh('mon,tue,wed,thu,fri 9:00-12:00,13:00-18:00'))).toEqual({
			ok: true,
			value: 'mon - fri 9:00 - 12:00, 13:00 - 18:00',
		});
		expect(printWorkingHours(wh('sun,sat off'))).toEqual({ ok: true, value: 'sat, sun off' });
		expect(printWorkingHours(wh('sat - mon 9:00 - 13:00'))).toEqual({
			ok: true,
			value: 'mon, sat, sun 9:00 - 13:00',
		});
		expect(printDays(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])).toEqual({
			ok: true,
			value: 'mon - sun',
		});
		expect(printDays([]).ok).toBe(false);
	});

	it('keeps the meaning of every written form', () => {
		for (const text of [
			'sat - mon 9:00 - 13:00',
			'mon 9:75 - 12:00',
			'tue, thu 9:00 - 12:00, 13:00 - 18:00',
			'wed off',
		]) {
			const p = printWorkingHours(wh(text));
			expect(p.ok && sameWorkingHours(wh(p.value), wh(text))).toBe(true);
		}
	});

	it('prints times without a leading zero', () => {
		expect(printTimeOfDay(510)).toEqual({ ok: true, value: '8:30' });
		expect(printTimeOfDay(1441).ok).toBe(false);
	});
});

describe('working hours from the edit API', () => {
	it('builds a canonical value', () => {
		expect(workingHoursFrom(['fri', 'mon'], [['9:00', '12:00']])).toEqual({
			ok: true,
			value: { days: ['mon', 'fri'], hours: [[540, 720]] },
		});
		expect(workingHoursFrom(['sat'], 'off')).toEqual({
			ok: true,
			value: { days: ['sat'], hours: [] },
		});
		expect(workingHoursFrom(['mon'], [['12:00', '9:00']]).ok).toBe(false);
		expect(workingHoursFrom([], 'off').ok).toBe(false);
		expect(workingHoursFrom(['mon'], [['9', '12:00']]).ok).toBe(false);
	});
});

describe('week tables', () => {
	it('starts from Mon-Fri 9:00-17:00 and applies statements in order', () => {
		expect(weeklyWorkingHours(DEFAULT_WEEK)).toBe(40);
		// golden syn-14: mon - thu 8:30 - 12:30, 13:30 - 17:00 and fri 8:30 - 12:30 is 34 h.
		const w = applyWorkingHours(
			applyWorkingHours(DEFAULT_WEEK, wh('mon - thu 8:30 - 12:30, 13:30 - 17:00')),
			wh('fri 8:30 - 12:30'),
		);
		expect(weeklyWorkingHours(w)).toBe(34);
		expect(weeklyWorkingHours(applyWorkingHours(DEFAULT_WEEK, wh('mon 9:00 - 9:30')))).toBe(32);
	});
});

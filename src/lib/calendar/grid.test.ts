// SPDX-License-Identifier: GPL-2.0-or-later
// The Calendar's days and months (grid.ts): the frame's local days from the heatmap's day axis, a
// month as 6 weeks of 42 cells, Monday or Sunday first, a first month that starts mid-month, and
// the 23 and 25 hour days of a clock change.
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../engine/timezone';
import { project } from '../schedule/testing';
import { buildGrid, cellOfDate, dateOfCell, EMPTY_GRID, weekdayOrder } from './grid';

const zones = createTimeZoneHost();

describe('days', () => {
	// 2026-01-05 (a Monday) to 2026-03-02: 56 days.
	const g = buildGrid(project(), zones);

	it('has one day per local day of the frame, with its civil date and weekday', () => {
		expect(g.days).toHaveLength(56);
		expect(g.days[0]).toMatchObject({
			from: 0,
			to: 1440,
			year: 2026,
			month: 1,
			date: 5,
			weekday: 1,
		});
		expect(g.days[55]).toMatchObject({ year: 2026, month: 3, date: 1, weekday: 0 });
		expect(g.days.every((d, i) => d.to - d.from === 1440 && d.from === i * 1440)).toBe(true);
	});

	it('finds the day of a minute, and -1 outside the frame', () => {
		expect(g.dayAt(0)).toBe(0);
		expect(g.dayAt(1439)).toBe(0);
		expect(g.dayAt(1440)).toBe(1);
		expect(g.dayAt(-1)).toBe(-1);
		expect(g.dayAt(56 * 1440)).toBe(-1);
	});

	it('is empty without a project or a frame', () => {
		expect(buildGrid(null, zones)).toBe(EMPTY_GRID);
		const empty = buildGrid(project({ end: '2026-01-05T00:00:00Z' }), zones);
		expect(empty.days).toHaveLength(0);
		expect(empty.months).toHaveLength(0);
	});
});

describe('months', () => {
	const g = buildGrid(project(), zones);

	it('lists every month the frame touches, the first starting before the frame', () => {
		expect(g.months.map((m) => [m.year, m.month])).toEqual([
			[2026, 1],
			[2026, 2],
			[2026, 3],
		]);
		// January's 1st is 4 days before the frame's first day.
		expect(g.months[0]).toMatchObject({ base: -4, length: 31 });
		expect(g.months[1]).toMatchObject({ base: 27, length: 28 });
		expect(g.months[2]).toMatchObject({ base: 55, length: 31 });
	});

	it('leads each month with the empty cells before its 1st, Monday first', () => {
		// 2026-01-01 is a Thursday: 3 cells before it on a Monday-first week.
		expect(g.months[0]?.lead).toBe(3);
		// 2026-02-01 is a Sunday: 6 cells.
		expect(g.months[1]?.lead).toBe(6);
		expect(g.months[2]?.lead).toBe(6);
	});

	it('leads with a Sunday-first week when the plan says so', () => {
		const s = buildGrid(project({ weekStartsMonday: false }), zones);
		expect(s.months[0]?.lead).toBe(4);
		expect(s.months[1]?.lead).toBe(0);
		expect(weekdayOrder(false)).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(weekdayOrder(true)).toEqual([1, 2, 3, 4, 5, 6, 0]);
	});

	it('maps a date of a month to a day, or -1 where the frame does not reach', () => {
		const jan = g.months[0];
		if (!jan) throw new Error('no month');
		expect(g.dayOfDate(jan, 4)).toBe(-1);
		expect(g.dayOfDate(jan, 5)).toBe(0);
		expect(g.dayOfDate(jan, 31)).toBe(26);
		const mar = g.months[2];
		if (!mar) throw new Error('no month');
		expect(g.dayOfDate(mar, 1)).toBe(55);
		expect(g.dayOfDate(mar, 2)).toBe(-1);
		expect(g.monthOf(0)).toBe(0);
		expect(g.monthOf(27)).toBe(1);
		expect(g.monthOf(99)).toBe(-1);
	});

	it('places a date in the 42 cells and back', () => {
		const m = g.months[0];
		if (!m) throw new Error('no month');
		expect(cellOfDate(m, 1)).toBe(3);
		expect(dateOfCell(m, 3)).toBe(1);
		expect(dateOfCell(m, 2)).toBeNull();
		expect(dateOfCell(m, 3 + 31)).toBeNull();
		for (const month of g.months) expect(month.lead + month.length).toBeLessThanOrEqual(42);
	});
});

describe('a clock change', () => {
	it('keeps local days: 23 and 25 hours across Berlin and New York changes', () => {
		// Berlin: the clocks go back on 2026-10-25 (a 25 hour day) and forward on 2026-03-29 (23).
		const berlin = buildGrid(
			project({
				timezone: 'Europe/Berlin',
				start: '2026-03-27T23:00:00Z',
				end: '2026-03-31T22:00:00Z',
			}),
			zones,
		);
		expect(berlin.days.map((d) => [d.date, (d.to - d.from) / 60])).toEqual([
			[28, 24],
			[29, 23],
			[30, 24],
			[31, 24],
		]);
		const autumn = buildGrid(
			project({
				timezone: 'Europe/Berlin',
				start: '2026-10-24T22:00:00Z',
				end: '2026-10-27T23:00:00Z',
			}),
			zones,
		);
		expect(autumn.days.map((d) => [d.date, (d.to - d.from) / 60])).toEqual([
			[25, 25],
			[26, 24],
			[27, 24],
		]);
	});

	it('reads the civil date of the first day in the plan zone, not UTC', () => {
		// 2026-01-05 00:00 in New York is 05:00Z; the day is the 5th.
		const g = buildGrid(
			project({
				timezone: 'America/New_York',
				start: '2026-01-05T05:00:00Z',
				end: '2026-01-08T05:00:00Z',
			}),
			zones,
		);
		expect(g.days.map((d) => d.date)).toEqual([5, 6, 7]);
		expect(g.days[0]?.weekday).toBe(1);
	});
});

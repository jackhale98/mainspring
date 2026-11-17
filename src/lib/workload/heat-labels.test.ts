// SPDX-License-Identifier: GPL-2.0-or-later
// The heatmap's time labels (phase-3.md 9.2, 10): the two header rows and the period of a cell in
// words, for days, weeks and months, in the plan's zone across a clock change (New York,
// 8 March 2026: the week of 2 March is 167 hours long and the week of 9 March starts on EDT), with
// a Sunday week start, and one set of labels per axis.
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../engine/timezone';
import type { GanttCalendar } from '../gantt/ticks';
import { project } from '../schedule/testing';
import { bucketAxis } from './axis';
import { axisLabels, dayText } from './heat-labels';
import type { BucketKind } from './types';

const zones = createTimeZoneHost();

/** 2 March to 6 April 2026 in New York: frame start is local midnight, 05:00 UTC (EST). */
const NY = project({
	start: '2026-03-02T05:00:00Z',
	end: '2026-04-06T04:00:00Z',
	timezone: 'America/New_York',
	weekStartsMonday: true,
	timingResolutionMin: 60,
});

function labelsOf(kind: BucketKind, p = NY, locale = 'en-GB') {
	const axis = bucketAxis(p, zones, kind);
	const cal: GanttCalendar = {
		startEpoch: Date.parse(p.start) / 1000,
		env: { zone: p.timezone, zones },
		locale,
	};
	return { axis, labels: axisLabels(cal, axis) };
}

describe('week labels across a clock change', () => {
	const { axis, labels } = labelsOf('week');

	it('names each week by the day it starts, the week of the change included', () => {
		expect(axis.count).toBe(5);
		// The week of 2 March has 167 hours (spring forward on the Sunday); 9 March starts on EDT.
		expect(axis.bounds[1]! - axis.bounds[0]!).toBe(167 * 60);
		expect(labels.minor).toEqual(['2', '9', '16', '23', '30']);
		expect(labels.period).toEqual([
			'week of 2 March',
			'week of 9 March',
			'week of 16 March',
			'week of 23 March',
			'week of 30 March',
		]);
	});

	it('groups the weeks under the month they start in', () => {
		expect(labels.major.map((g) => [g.c0, g.c1, g.name, g.year])).toEqual([
			[0, 5, 'March', '2026'],
		]);
	});

	it('keeps the local calendar day of each column', () => {
		expect(labels.day.length).toBe(5);
		expect(labels.day[1]! - labels.day[0]!).toBe(7);
	});
});

describe('day and month labels', () => {
	it('labels days with the day number and the weekday in words', () => {
		const { labels } = labelsOf('day');
		expect(labels.minor.slice(0, 8)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9']);
		expect(labels.period[0]).toMatch(/^Monday,? 2 March$/);
		// The day of the clock change is a day like the others, the next one starts on EDT.
		expect(labels.period[6]).toMatch(/^Sunday,? 8 March$/);
		expect(labels.period[7]).toMatch(/^Monday,? 9 March$/);
		expect(labels.major.map((g) => g.name)).toEqual(['March', 'April']);
	});

	it('labels months with the short name, and years above', () => {
		const { labels } = labelsOf('month');
		expect(labels.minor).toEqual(['Mar', 'Apr']);
		expect(labels.period).toEqual(['March 2026', 'April 2026']);
		expect(labels.major).toEqual([{ c0: 0, c1: 2, name: '2026', year: '' }]);
	});
});

describe('a Sunday week start', () => {
	it('starts the weeks on Sunday when the plan does', () => {
		const { labels } = labelsOf('week', { ...NY, weekStartsMonday: false });
		// 2 March is a Monday: its week began on Sunday 1 March.
		expect(labels.period[0]).toBe('week of 1 March');
		expect(labels.minor[1]).toBe('8');
	});
});

describe('dayText and caching', () => {
	it('writes a calendar day in each style, in the viewer locale', () => {
		const day = Date.UTC(2026, 2, 9) / 86_400_000;
		expect(dayText(day, 'day-month', 'en-GB')).toBe('9 March');
		expect(dayText(day, 'day-month', 'en-US')).toBe('March 9');
		expect(dayText(day, 'month-short', 'en-GB')).toBe('Mar');
		expect(dayText(day, 'month-year', 'en-GB')).toBe('March 2026');
		expect(dayText(day, 'day-number', 'en-GB')).toBe('9');
	});

	it('keeps one set of labels per axis', () => {
		const { axis, labels } = labelsOf('week');
		const cal: GanttCalendar = { startEpoch: 0, env: { zone: null, zones }, locale: 'fr' };
		expect(axisLabels(cal, axis)).toBe(labels);
	});
});

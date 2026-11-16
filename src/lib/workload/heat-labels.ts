// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the heatmap writes about time (phase-3.md 9.3, 10): the two header rows and the period a
 * cell stands for ("week of 9 March"). Dates stay integer minutes; `Intl` only writes the labels,
 * always from a UTC date at noon so the viewer's own zone cannot move a label to another day (as
 * gantt/ticks.ts does). The calendar days are the plan's own local days (`dayOf`), read from the
 * axis's bounds, which are local midnights of the project zone.
 *
 * The labels of one axis are made once and kept (by the axis object), so scrolling and the ARIA
 * mirror ask for them without a formatter call.
 */
import { dayOf, type GanttCalendar } from '../gantt/ticks';
import { workloadStrings as W } from '../strings';
import { civilFromDays } from '../tjp/values/civil';
import type { BucketAxis, BucketKind } from './types';

/** One group of the upper header row: columns [c0, c1) under one month (or year). */
export interface HeaderGroup {
	readonly c0: number;
	readonly c1: number;
	/** "March" or "2026", and the year after a month name, when it is worth saying. */
	readonly name: string;
	readonly year: string;
}

export interface AxisLabels {
	/** The lower row: a day number, the day a week starts, or a short month name. */
	readonly minor: readonly string[];
	/** The upper row: months for days and weeks, years for months. */
	readonly major: readonly HeaderGroup[];
	/** Per column: the period in words, for the cell's accessible name and the details. */
	readonly period: readonly string[];
	/** Per column: the local calendar day it starts (days since 1970-01-01). */
	readonly day: Int32Array;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function format(locale: string | undefined, key: string, o: Intl.DateTimeFormatOptions) {
	const id = `${locale ?? ''}|${key}`;
	let f = formatters.get(id);
	if (!f) formatters.set(id, (f = new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' })));
	return f;
}

/** A calendar day as `Intl` writes it in a style (from a UTC date at noon). */
export function dayText(
	day: number,
	style:
		'day-number' | 'month-short' | 'month-long' | 'day-month' | 'weekday-day-month' | 'month-year',
	locale?: string,
): string {
	const { year, month, day: d } = civilFromDays(day);
	const at = new Date(Date.UTC(year, month - 1, d, 12));
	switch (style) {
		case 'day-number':
			return String(d);
		case 'month-short':
			return format(locale, style, { month: 'short' }).format(at);
		case 'month-long':
			return format(locale, style, { month: 'long' }).format(at);
		case 'day-month':
			return format(locale, style, { day: 'numeric', month: 'long' }).format(at);
		case 'weekday-day-month':
			return format(locale, style, { weekday: 'long', day: 'numeric', month: 'long' }).format(at);
		case 'month-year':
			return format(locale, style, { month: 'long', year: 'numeric' }).format(at);
	}
}

function periodOf(kind: BucketKind, day: number, locale: string | undefined): string {
	if (kind === 'day') return dayText(day, 'weekday-day-month', locale);
	if (kind === 'week') return W.periodWeek(dayText(day, 'day-month', locale));
	return dayText(day, 'month-year', locale);
}

function build(cal: GanttCalendar, axis: BucketAxis): AxisLabels {
	const n = axis.count;
	const kind = axis.kind;
	const locale = cal.locale;
	const days = new Int32Array(n);
	const minor: string[] = [];
	const period: string[] = [];
	const major: HeaderGroup[] = [];
	let key = -1;
	for (let c = 0; c < n; c++) {
		const day = dayOf(cal, axis.bounds[c] as number);
		days[c] = day;
		const { year, month } = civilFromDays(day);
		minor.push(
			kind === 'month' ? dayText(day, 'month-short', locale) : dayText(day, 'day-number', locale),
		);
		period.push(periodOf(kind, day, locale));
		const k = kind === 'month' ? year : year * 12 + month;
		const last = major[major.length - 1];
		if (k === key && last) {
			major[major.length - 1] = { ...last, c1: c + 1 };
		} else {
			key = k;
			major.push({
				c0: c,
				c1: c + 1,
				name: kind === 'month' ? String(year) : dayText(day, 'month-long', locale),
				year: kind === 'month' ? '' : String(year),
			});
		}
	}
	return { minor, major, period, day: days };
}

const kept = new WeakMap<BucketAxis, AxisLabels>();

/** The labels of an axis, made on the first call (the axis is never changed once built). */
export function axisLabels(cal: GanttCalendar, axis: BucketAxis): AxisLabels {
	let l = kept.get(axis);
	if (!l) kept.set(axis, (l = build(cal, axis)));
	return l;
}

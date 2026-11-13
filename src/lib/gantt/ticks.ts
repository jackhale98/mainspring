// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Time-header ticks (phase-2.md 6.4): two rows of cells over a range of minutes, chosen by zoom.
 *
 * | Pixels per day | Upper row | Lower row |
 * | --- | --- | --- |
 * | 30 or more | month and year | each day |
 * | 9 or more | month and year | each week (Monday on) |
 * | 2.5 or more | year | each month |
 * | less | year | each quarter |
 *
 * Cell edges are local midnights in the project's time zone, so a day cell is 23 or 25 hours long
 * across a clock change, as the schedule itself is. Dates stay integer minutes since the project
 * start; `Intl` only writes the labels (always from a UTC date at noon, so the viewer's own zone
 * cannot move a label to another day).
 */
import type { Minutes } from '../../engine/protocol';
import { strings } from '../strings';
import {
	civilFromDays,
	daysFromCivil,
	epochToLocal,
	fieldsFromUtc,
	localToEpoch,
	type ZoneEnv,
} from '../tjp/values';

export type TickLevel = 'day' | 'week' | 'month' | 'quarter';

export interface Tick {
	readonly at: Minutes;
	readonly end: Minutes;
	readonly label: string;
}

export interface TickRows {
	readonly level: TickLevel;
	readonly major: readonly Tick[];
	readonly minor: readonly Tick[];
}

/** What the header needs to turn minutes into calendar days: the project start and its zone. */
export interface GanttCalendar {
	/** `ProjectInfo.start` as epoch seconds. */
	readonly startEpoch: number;
	readonly env: ZoneEnv;
	/** BCP 47 tag for labels; undefined means the viewer's own. */
	readonly locale?: string | undefined;
}

const MAX_CELLS = 2000;

export function tickLevel(pxPerDay: number): TickLevel {
	if (pxPerDay >= 30) return 'day';
	if (pxPerDay >= 9) return 'week';
	if (pxPerDay >= 2.5) return 'month';
	return 'quarter';
}

/** The calendar day (days since 1970-01-01) that holds a minute, in the project's zone. */
export function dayOf(cal: GanttCalendar, m: Minutes): number {
	const epoch = cal.startEpoch + m * 60;
	const f = epochToLocal(epoch, cal.env) ?? fieldsFromUtc(epoch);
	return daysFromCivil(f.year, f.month, f.day);
}

/** The minute of local midnight at the start of a calendar day. */
export function midnightOf(cal: GanttCalendar, day: number): Minutes {
	const { year, month, day: d } = civilFromDays(day);
	const f = { year, month, day: d, hour: 0, minute: 0, second: 0 };
	const epoch = localToEpoch(f, cal.env) ?? Date.UTC(year, month - 1, d) / 1000;
	return Math.round((epoch - cal.startEpoch) / 60);
}

/** Weekday of a day number, 0 = Sunday. */
export function weekdayOfDay(day: number): number {
	return (((day + 4) % 7) + 7) % 7;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string | undefined, key: string, o: Intl.DateTimeFormatOptions) {
	const id = `${locale ?? ''}|${key}`;
	let f = formatters.get(id);
	if (!f) {
		f = new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' });
		formatters.set(id, f);
	}
	return f;
}

export type DateStyle =
	'weekday-day' | 'month-day' | 'medium' | 'month' | 'month-year' | 'year' | 'full';
const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
	// Written as the weekday, then the day, whatever the locale's own order (see `dayLabel`).
	'weekday-day': { weekday: 'short' },
	'month-day': { month: 'short', day: 'numeric' },
	/** A date with its year, for the task list's Start and End columns: "Mar 3, 2026". */
	medium: { month: 'short', day: 'numeric', year: 'numeric' },
	month: { month: 'short' },
	'month-year': { month: 'long', year: 'numeric' },
	year: { year: 'numeric' },
	full: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
};

/** Writes a calendar day in a style, with `Intl`. */
export function dayLabel(cal: GanttCalendar, day: number, style: DateStyle): string {
	const { year, month, day: d } = civilFromDays(day);
	const text = formatter(cal.locale, style, STYLES[style]).format(
		new Date(Date.UTC(year, month - 1, d, 12)),
	);
	return style === 'weekday-day' ? `${text} ${d}` : text;
}

/** A minute written as a date, in the project's zone (display only). */
export function formatMinutes(cal: GanttCalendar, m: Minutes, style: DateStyle = 'full'): string {
	return dayLabel(cal, dayOf(cal, m), style);
}

interface Period {
	floor(day: number): number;
	next(day: number): number;
	label(cal: GanttCalendar, day: number): string;
}

const monthStart = (day: number, add: number): number => {
	const { year, month } = civilFromDays(day);
	const index = year * 12 + (month - 1) + add;
	return daysFromCivil(Math.floor(index / 12), (index % 12) + 1, 1);
};
const quarterStart = (day: number, add: number): number => {
	const { year, month } = civilFromDays(day);
	const index = year * 12 + Math.floor((month - 1) / 3) * 3 + add * 3;
	return daysFromCivil(Math.floor(index / 12), (index % 12) + 1, 1);
};

const PERIODS = {
	day: {
		floor: (d) => d,
		next: (d) => d + 1,
		label: (c, d) => dayLabel(c, d, 'weekday-day'),
	},
	week: {
		floor: (d) => d - ((weekdayOfDay(d) + 6) % 7),
		next: (d) => d + 7,
		label: (c, d) => dayLabel(c, d, 'month-day'),
	},
	month: {
		floor: (d) => monthStart(d, 0),
		next: (d) => monthStart(d, 1),
		label: (c, d) => dayLabel(c, d, 'month'),
	},
	longMonth: {
		floor: (d) => monthStart(d, 0),
		next: (d) => monthStart(d, 1),
		label: (c, d) => dayLabel(c, d, 'month-year'),
	},
	quarter: {
		floor: (d) => quarterStart(d, 0),
		next: (d) => quarterStart(d, 1),
		label: (_c, d) => strings.gantt.quarter(Math.floor((civilFromDays(d).month - 1) / 3) + 1),
	},
	year: {
		floor: (d) => daysFromCivil(civilFromDays(d).year, 1, 1),
		next: (d) => daysFromCivil(civilFromDays(d).year + 1, 1, 1),
		label: (c, d) => dayLabel(c, d, 'year'),
	},
} satisfies Record<string, Period>;

function cells(cal: GanttCalendar, from: Minutes, to: Minutes, p: Period): Tick[] {
	const out: Tick[] = [];
	let day = p.floor(dayOf(cal, from));
	for (let n = 0; n < MAX_CELLS; n++) {
		const at = midnightOf(cal, day);
		if (at >= to) break;
		const nextDay = p.next(day);
		out.push({ at, end: midnightOf(cal, nextDay), label: p.label(cal, day) });
		day = nextDay;
	}
	return out;
}

/** The header cells that touch [from, to) at a zoom. */
export function ticksFor(
	cal: GanttCalendar,
	from: Minutes,
	to: Minutes,
	pxPerDay: number,
): TickRows {
	const level = tickLevel(pxPerDay);
	const rows: Record<TickLevel, readonly [Period, Period]> = {
		day: [PERIODS.longMonth, PERIODS.day],
		week: [PERIODS.longMonth, PERIODS.week],
		month: [PERIODS.year, PERIODS.month],
		quarter: [PERIODS.year, PERIODS.quarter],
	};
	const [major, minor] = rows[level];
	return { level, major: cells(cal, from, to, major), minor: cells(cal, from, to, minor) };
}

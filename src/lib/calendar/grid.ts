// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Calendar's days and months (phase-3.md 9.5, 8.2): every local day of the project frame, and
 * the month blocks that show them as a grid of 6 weeks (42 cells).
 *
 * - A day is a local day of the plan's zone, `[from, to)` in minutes since the project start. They
 *   come from the heatmap's day axis (workload/axis.ts), so a day across a clock change is 23 or
 *   25 hours long, as everywhere else, and a leave painted over a run of days is whole local days
 *   (`planLeavePaint` snaps to the same midnights). The first day's start is at or before 0 and the
 *   last day ends at the frame end, so those two can be partial.
 * - The days are consecutive civil days, so the civil date of day `i` is the first day's plus `i`
 *   (no zone data is read after the first day) and a month's day of the month `d` is day
 *   `base + d - 1`, which is outside the frame when it is below 0 or past the last day.
 * - A month block has a fixed 6 rows, so every block has the same height and the list can place
 *   the ones in view without measuring the others (window.ts).
 * - Weeks start on Monday or Sunday by `ProjectInfo.weekStartsMonday`, as the heatmap's weeks do.
 *
 * Nothing here reads a clock or changes anything. Dates in views are minutes; `Intl` is for the
 * labels in describe.ts.
 */
import type { Minutes, ProjectInfo } from '../../engine/protocol';
import { bucketAxis } from '../workload/axis';
import {
	civilFromDays,
	daysFromCivil,
	epochToLocal,
	fieldsFromUtc,
	type ZoneOffsets,
} from '../tjp/values/civil';

/** One local day of the frame. */
export interface CalendarDay {
	readonly from: Minutes;
	readonly to: Minutes;
	readonly year: number;
	/** 1 to 12. */
	readonly month: number;
	/** The day of the month, from 1. */
	readonly date: number;
	/** 0 is Sunday. */
	readonly weekday: number;
}

/**
 * A month of the frame, as a grid of 42 cells: `lead` empty cells, then its `length` days, then
 * empty cells. `base` is the index of the month's first day among the frame's days: below 0 for the
 * first month when the frame starts mid-month, and `base + length` can pass the last day for the
 * last month.
 */
export interface MonthBlock {
	readonly year: number;
	readonly month: number;
	readonly lead: number;
	readonly length: number;
	readonly base: number;
}

export interface CalendarGrid {
	readonly days: readonly CalendarDay[];
	readonly months: readonly MonthBlock[];
	readonly weekStartsMonday: boolean;
	/** The day holding minute `m` (`[m, m + 1)`), or -1 outside the frame. */
	dayAt(m: Minutes): number;
	/** The month block that holds day `i`, or -1. */
	monthOf(i: number): number;
	/** The day index of a month's date, or -1 when it falls outside the frame. */
	dayOfDate(month: MonthBlock, date: number): number;
}

/** A frame with no day (no project, an empty frame, or a failed parse). */
export const EMPTY_GRID: CalendarGrid = {
	days: [],
	months: [],
	weekStartsMonday: true,
	dayAt: () => -1,
	monthOf: () => -1,
	dayOfDate: () => -1,
};

/** Weekday of a day number (days since 1970-01-01), 0 = Sunday. */
const weekdayOfDays = (n: number): number => (((n + 4) % 7) + 7) % 7;

/** The length of a month. */
const monthLength = (year: number, month: number): number =>
	daysFromCivil(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) -
	daysFromCivil(year, month, 1);

/** The days and months of a project's frame, in its zone. */
export function buildGrid(project: ProjectInfo | null, zones: ZoneOffsets): CalendarGrid {
	if (!project) return EMPTY_GRID;
	const axis = bucketAxis(project, zones, 'day');
	if (axis.count <= 0) return EMPTY_GRID;
	const startEpoch = Date.parse(project.start) / 1000;
	const first = axis.bounds[0] as number;
	const local =
		epochToLocal(startEpoch + first * 60, { zone: project.timezone, zones }) ??
		fieldsFromUtc(startEpoch + first * 60);
	const day0 = daysFromCivil(local.year, local.month, local.day);
	const days: CalendarDay[] = [];
	for (let i = 0; i < axis.count; i++) {
		const n = day0 + i;
		const c = civilFromDays(n);
		days.push({
			from: axis.bounds[i] as number,
			to: axis.bounds[i + 1] as number,
			year: c.year,
			month: c.month,
			date: c.day,
			weekday: weekdayOfDays(n),
		});
	}
	const startsMonday = project.weekStartsMonday;
	const firstDay = days[0] as CalendarDay;
	const lastDay = days[days.length - 1] as CalendarDay;
	const months: MonthBlock[] = [];
	let y = firstDay.year;
	let m = firstDay.month;
	for (;;) {
		const n1 = daysFromCivil(y, m, 1);
		const lead = (weekdayOfDays(n1) - (startsMonday ? 1 : 0) + 7) % 7;
		months.push({ year: y, month: m, lead, length: monthLength(y, m), base: n1 - day0 });
		if (y === lastDay.year && m === lastDay.month) break;
		if (m === 12) {
			y++;
			m = 1;
		} else m++;
	}
	return {
		days,
		months,
		weekStartsMonday: startsMonday,
		dayAt: (min) => axis.indexOf(min),
		monthOf(i) {
			const d = days[i];
			if (!d) return -1;
			return months.findIndex((b) => b.year === d.year && b.month === d.month);
		},
		dayOfDate(month, date) {
			const i = month.base + date - 1;
			return i >= 0 && i < days.length ? i : -1;
		},
	};
}

/** The weekday headers' order: Monday first or Sunday first, as numbers (0 is Sunday). */
export const weekdayOrder = (startsMonday: boolean): readonly number[] =>
	startsMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];

/** The day of the cell at `pos` (0 to 41) of a month block, or null for an empty cell. */
export function dateOfCell(month: MonthBlock, pos: number): number | null {
	const d = pos - month.lead + 1;
	return d >= 1 && d <= month.length ? d : null;
}

/** The cell position of a month's date. */
export const cellOfDate = (month: MonthBlock, date: number): number => month.lead + date - 1;

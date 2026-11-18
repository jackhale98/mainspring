// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Calendar's words (phase-3.md 9.5, 10): month titles, weekday headers, a day's accessible name
 * and the line that says which days are selected. Dates are read from the civil date of a day
 * (`CalendarDay`), with `Intl` in UTC so that the plan's zone cannot move a date; the viewer's
 * locale is used for the names.
 */
import { calendarStrings as C, leavePaintStrings as L } from '../strings-calendar';
import type { LeaveType } from '../tjp/values';
import type { CalendarDay, CalendarGrid } from './grid';
import type { DayFacts, LeaveEntry } from './facts';

const formatters = new Map<string, Intl.DateTimeFormat>();

function format(locale: string | undefined, opts: Intl.DateTimeFormatOptions, at: Date): string {
	const key = `${locale ?? ''}|${JSON.stringify(opts)}`;
	let f = formatters.get(key);
	if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' })));
	return f.format(at);
}

const civil = (year: number, month: number, date: number): Date =>
	new Date(Date.UTC(year, month - 1, date));

/** "November 2026". */
export function monthTitle(year: number, month: number, locale?: string): string {
	return format(locale, { month: 'long', year: 'numeric' }, civil(year, month, 1));
}

/** The month's title where there is little room: "Nov 2026". */
export function monthTitleShort(year: number, month: number, locale?: string): string {
	return format(locale, { month: 'short', year: 'numeric' }, civil(year, month, 1));
}

/** A weekday header: "Mon"(`long` for the accessible name: "Monday"). */
export function weekdayName(weekday: number, long = false, locale?: string): string {
	// 2023-01-01 was a Sunday.
	return format(locale, { weekday: long ? 'long' : 'short' }, civil(2023, 1, 1 + weekday));
}

/** "Thu 26 Nov 2026". */
export function dateLabel(
	d: Pick<CalendarDay, 'year' | 'month' | 'date'>,
	locale?: string,
): string {
	return format(
		locale,
		{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
		civil(d.year, d.month, d.date),
	);
}

export const typeName = (t: LeaveType): string => L.type[t];

/** One leave as a short phrase: "Annual leave: Trip", "Holiday: Thanksgiving". */
export function leavePhrase(e: Pick<LeaveEntry, 'type' | 'name'>): string {
	return e.type === 'holiday' ? C.holiday(e.name) : C.leave(typeName(e.type), e.name);
}

/** One thing a day lists (a chip in the month grid, a mark in a narrow one). */
export interface DayChip {
	readonly kind: 'holiday' | 'leave' | 'milestone';
	readonly text: string;
	/** The leave has no text item: a shift or a macro. */
	readonly textOnly: boolean;
	readonly task?: string;
}

/** What a day lists, in the order the cell shows it: holidays, the scope's leaves, milestones. */
export function dayChips(f: DayFacts): DayChip[] {
	const out: DayChip[] = [];
	for (const e of f.holidays) {
		out.push({
			kind: 'holiday',
			text: e.type === 'holiday' ? (e.name ?? typeName(e.type)) : leavePhrase(e),
			textOnly: e.item === null,
		});
	}
	for (const e of f.leaves) {
		out.push({ kind: 'leave', text: leavePhrase(e), textOnly: e.item === null });
	}
	for (const m of f.milestones) {
		out.push({ kind: 'milestone', text: m.name, textOnly: false, task: m.task });
	}
	return out;
}

/** How many chips a day cell shows in full; the rest are "+N" and are named in `dayExtra`. */
export const MAX_CHIPS = 2;

/**
 * What a day cell says besides its number and the chips it shows, as screen-reader text that
 * follows them: the full date, the chips beyond the `shown` ones (`MAX_CHIPS` unless the cell
 * has room for more: the month that fills the view), a leave no text item names, and
 * whether the day is a non-working day. The cell's accessible name is its content (the number,
 * the chips, then this), so it always begins with the text on screen (WCAG 2.5.3) and nothing is
 * told by colour or a pattern alone (1.4.1).
 */
export function dayExtra(
	d: CalendarDay,
	f: DayFacts,
	locale?: string,
	shown: number = MAX_CHIPS,
): string {
	const parts: string[] = [dateLabel(d, locale)];
	const chips = dayChips(f);
	// A holiday's chip shows its name; the word says what kind of day it is.
	if (f.holidays.some((e) => e.type === 'holiday')) parts.push(C.holiday(null));
	for (const c of chips.slice(shown)) {
		parts.push(c.kind === 'milestone' ? C.milestone(c.text) : c.text);
	}
	if (chips.some((c) => c.textOnly)) parts.push(C.textOnly);
	if (!f.working && f.top === null) parts.push(C.nonWorking);
	return parts.join(', ');
}

/** "Mon 2 Mar 2026 to Fri 6 Mar 2026", or one date. */
export function rangeLabel(grid: CalendarGrid, lo: number, hi: number, locale?: string): string {
	const a = grid.days[lo];
	const b = grid.days[hi];
	if (!a || !b) return '';
	return L.days(dateLabel(a, locale), dateLabel(b, locale));
}

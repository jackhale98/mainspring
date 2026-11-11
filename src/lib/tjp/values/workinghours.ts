// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Working hours: `workinghours listOfDays listOfTimes` (TjpSyntaxRules.rb:7711-7739).
 *
 * - Days: `weekday ('-' weekday)?` items separated by `,` (:2553-2561, 7616-7653). A range wraps
 *   around the week (`sat - mon` is Sat, Sun, Mon). After a `,` another day must follow.
 * - Times: `off`, or `TIME - TIME` items separated by `,` (:2563-2570, 6987-6996). TIME is
 *   `\d{1,2}:\d{2}`; the scanner refuses hours past 24 and 24:xx other than 24:00, but its minute
 *   check tests the hour by mistake (ProjectFileScanner.rb:166-180), so `9:75` is read as 10:15.
 *   Each interval must end after it starts (`time_interval`) and within the day (`bad_workinghours`,
 *   WorkingHours.rb:107-126).
 *
 * The value is semantic: the set of days (in `WEEKDAYS` order) and the intervals in minutes
 * since midnight, in written order; `[]` is `off`. Printing writes day runs of three or more as
 * ranges (`mon - fri`) and times as `9:00`.
 */
import { parseWith, type Cursor } from './cursor';
import type { Token } from './lex';
import { fail, ok, raise, type Parsed, type Result, type Span } from './result';

/** TaskJuggler's weekday keywords, in TaskJuggler's index order (Sunday = 0). */
export const TJ_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof TJ_WEEKDAYS)[number];
/** Canonical order of `WorkingHours.days`. */
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export type TimeRange = readonly [start: number, end: number];

export interface WorkingHours {
	readonly days: readonly Weekday[];
	/** Minutes since midnight; empty for `off`. */
	readonly hours: readonly TimeRange[];
}

const isWeekday = (s: string): s is Weekday => (TJ_WEEKDAYS as readonly string[]).includes(s);

function weekday(c: Cursor): number {
	const t = c.expect('id');
	if (!isWeekday(t.text)) raise('unexpected-token', t.from, t.to);
	return TJ_WEEKDAYS.indexOf(t.text as Weekday);
}

/** Minutes since midnight of a TIME token, with the scanner's checks. */
function timeFromToken(t: Token): number {
	const [hs, ms] = t.text.split(':');
	const h = Number(hs);
	const m = Number(ms);
	if (h > 24) raise('hour-range', t.from, t.to, 'time_bad_hour', { got: h });
	if (h === 24 && m !== 0) raise('time-range', t.from, t.to, 'time_bad_time');
	return h * 60 + m;
}

function readDays(c: Cursor): Weekday[] {
	const set = new Set<number>();
	do {
		const from = weekday(c);
		const to = c.eat('-') ? weekday(c) : from;
		for (let d = from; ; d = (d + 1) % 7) {
			set.add(d);
			if (d === to) break;
		}
	} while (c.eat(','));
	return WEEKDAYS.filter((d) => set.has(TJ_WEEKDAYS.indexOf(d)));
}

function readTimes(c: Cursor): TimeRange[] {
	if (c.isId('off')) {
		c.next();
		return [];
	}
	const list: TimeRange[] = [];
	do {
		const a = c.expect('time');
		const start = timeFromToken(a);
		c.expectLiteral('-');
		const b = c.expect('time');
		const end = timeFromToken(b);
		if (start >= end) raise('time-interval', a.from, b.to, 'time_interval');
		if (end > 24 * 60) raise('time-range', a.from, b.to, 'bad_workinghours');
		list.push([start, end]);
	} while (c.eat(','));
	return list;
}

/** Parses the text after the `workinghours` keyword. */
export function parseWorkingHours(
	text: string,
	base = 0,
): Parsed<WorkingHours, { days: Span; hours: Span }> {
	let days: Span = { from: base, to: base };
	let hours: Span = days;
	return parseWith(
		text,
		base,
		(c) => {
			const d0 = c.peek()?.from ?? c.end;
			const d = readDays(c);
			days = { from: d0, to: c.offset };
			const h0 = c.peek()?.from ?? c.end;
			const h = readTimes(c);
			hours = { from: h0, to: c.offset };
			return { days: d, hours: h };
		},
		() => ({ days, hours }),
	);
}

/** `9:00` from 540. */
export function printTimeOfDay(minutes: number): Result<string> {
	if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60)
		return fail('time-range', 0, 0);
	return ok(`${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`);
}

/** Minutes since midnight of `9:00`-style text (one TIME token). */
export function parseTimeOfDay(text: string, base = 0): Parsed<number> {
	return parseWith(text, base, (c) => timeFromToken(c.expect('time')));
}

function canonicalDays(days: readonly Weekday[]): Weekday[] | null {
	if (!days.every(isWeekday)) return null;
	return WEEKDAYS.filter((d) => days.includes(d));
}

export function printDays(days: readonly Weekday[]): Result<string> {
	const set = canonicalDays(days);
	if (set === null || set.length === 0) return fail('unrepresentable', 0, 0);
	const parts: string[] = [];
	let i = 0;
	while (i < WEEKDAYS.length) {
		const d = WEEKDAYS[i];
		if (d === undefined || !set.includes(d)) {
			i++;
			continue;
		}
		let j = i;
		while (j + 1 < WEEKDAYS.length && set.includes(WEEKDAYS[j + 1] as Weekday)) j++;
		const run = WEEKDAYS.slice(i, j + 1);
		parts.push(...(run.length >= 3 ? [`${run[0]} - ${run[run.length - 1]}`] : run));
		i = j + 1;
	}
	return ok(parts.join(', '));
}

export function printWorkingHours(wh: WorkingHours): Result<string> {
	const days = printDays(wh.days);
	if (!days.ok) return days;
	if (wh.hours.length === 0) return ok(`${days.value} off`);
	const items: string[] = [];
	for (const [s, e] of wh.hours) {
		const a = printTimeOfDay(s);
		const b = printTimeOfDay(e);
		if (!a.ok) return a;
		if (!b.ok) return b;
		if (s >= e) return fail('time-interval', 0, 0, 'time_interval');
		items.push(`${a.value} - ${b.value}`);
	}
	return ok(`${days.value} ${items.join(', ')}`);
}

export function sameWorkingHours(a: WorkingHours, b: WorkingHours): boolean {
	const da = canonicalDays(a.days) ?? [];
	const db = canonicalDays(b.days) ?? [];
	return (
		da.length === db.length &&
		da.every((d, i) => db[i] === d) &&
		a.hours.length === b.hours.length &&
		a.hours.every(([s, e], i) => b.hours[i]?.[0] === s && b.hours[i]?.[1] === e)
	);
}

/** The edit API's `setWorkingHours` arguments as a value (`hours` as `['9:00', '12:00']` pairs). */
export function workingHoursFrom(
	days: readonly Weekday[],
	hours: ReadonlyArray<readonly [string, string]> | 'off',
): Result<WorkingHours> {
	const set = canonicalDays(days);
	if (set === null || set.length === 0) return fail('unrepresentable', 0, 0);
	const list: TimeRange[] = [];
	for (const [a, b] of hours === 'off' ? [] : hours) {
		const s = parseTimeOfDay(a);
		if (!s.ok) return s;
		const e = parseTimeOfDay(b);
		if (!e.ok) return e;
		if (s.value >= e.value) return fail('time-interval', 0, 0, 'time_interval');
		list.push([s.value, e.value]);
	}
	return ok({ days: set, hours: list });
}

/** Working hours per TaskJuggler weekday index (Sunday = 0). */
export type WeekTable = readonly (readonly TimeRange[])[];

/** TaskJuggler's built-in default: Mon-Fri 9:00-17:00 (WorkingHours.rb:65-71). */
export const DEFAULT_WEEK: WeekTable = TJ_WEEKDAYS.map((d) =>
	d === 'sat' || d === 'sun' ? [] : [[540, 1020] as const],
);

/** A week table after a `workinghours` statement (later statements override earlier days). */
export function applyWorkingHours(week: WeekTable, wh: WorkingHours): WeekTable {
	return week.map((day, i) => (wh.days.includes(TJ_WEEKDAYS[i] as Weekday) ? wh.hours : day));
}

/** `WorkingHours#weeklyWorkingHours` (WorkingHours.rb:168-176): whole hours, rounded down. */
export function weeklyWorkingHours(week: WeekTable): number {
	let minutes = 0;
	for (const day of week) for (const [s, e] of day) minutes += e - s;
	return Math.floor((minutes * 60) / 3600);
}

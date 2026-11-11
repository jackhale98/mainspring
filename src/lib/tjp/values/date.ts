// SPDX-License-Identifier: GPL-2.0-only
// Close translation of TjTime#parse and TjpSyntaxRules.rb rule_date (TaskJuggler 3.8.4).
/**
 * Dates: `YYYY-MM-DD[-hh:mm[:ss]][-±HHMM]` (the DATE token, ProjectFileScanner.rb:88) and the
 * date expression `%{ DATE ± duration }` (`dateCalcedOrNot`, TjpSyntaxRules.rb:957-962).
 *
 * The checks are TjTime#parse's (TjTime.rb:423-526): year 1970 to 2035, month 1 to 12, hour 0 to
 * 23, minute and second 0 to 59. The zone needs an explicit sign after the dash (`-+0100`,
 * `--0500`; a bare `-0100` is refused) and lies within -12:00..+14:00. TjTime never checks the
 * day (its test compares the month by mistake, TjTime.rb:451), so `Time.mktime` rolls days 29 to
 * 31 into the next month and refuses 0 or more than 31; this module does the same.
 *
 * A date without a zone is local time in the project zone in force at that point (civil.ts).
 * Every date must also be aligned to the timing resolution (`rule_date`, TjpSyntaxRules.rb:912-921).
 *
 * Instants are integer epoch seconds; views use integer minutes since the project start
 * (`minutesSince`). Nothing here uses `Date`.
 */
import {
	epochToLocal,
	fieldsFromUtc,
	localInstants,
	localToEpoch,
	offsetAt,
	utcSeconds,
	type CivilFields,
	type ZoneEnv,
} from './civil';
import type { ProjectContext } from './context';
import { parseWith, type Cursor } from './cursor';
import {
	intervalSeconds,
	printDuration,
	readDuration,
	sameDuration,
	type Duration,
} from './duration';
import type { Token } from './lex';
import { at, fail, ok, raise, type Parsed, type Result } from './result';

export interface TjDate extends CivilFields {
	/** Explicit UTC offset in minutes (east positive), or null for the project zone. */
	readonly zone: number | null;
}

export type DateExpr =
	| { readonly kind: 'date'; readonly date: TjDate }
	| {
			readonly kind: 'calc';
			readonly base: TjDate;
			readonly sign: '+' | '-';
			readonly duration: Duration;
	  };

const DATE_RE =
	/^(\d{4})-(\d{1,2})-(\d{1,2})(?:-(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:-([-+]?)(\d{2})(\d{2}))?)?$/;

/** The TjDate a DATE token holds, with TjTime#parse's checks. */
export function dateFromToken(t: Token): TjDate {
	const m = DATE_RE.exec(t.text);
	if (!m) return raise('unexpected-token', t.from, t.to);
	const n = (i: number): number => Number(m[i] ?? '0');
	const bad = (
		code: 'year-range' | 'month-range' | 'hour-range' | 'minute-range' | 'second-range',
		got: number,
	) => raise(code, t.from, t.to, 'time_error', { got });
	const [year, month, day, hour, minute, second] = [n(1), n(2), n(3), n(4), n(5), n(6)];
	if (year < 1970 || year > 2035) bad('year-range', year);
	if (month < 1 || month > 12) bad('month-range', month);
	if (hour > 23) bad('hour-range', hour);
	if (minute > 59) bad('minute-range', minute);
	if (second > 59) bad('second-range', second);
	let zone: number | null = null;
	if (m[8] !== undefined) {
		if (m[7] === '') raise('zone-sign', t.from, t.to, 'time_error');
		const tzMinute = n(9);
		if (tzMinute > 59) raise('zone-range', t.from, t.to, 'time_error', { got: tzMinute });
		zone = (m[7] === '-' ? -1 : 1) * (n(8) * 60 + tzMinute) || 0; // `--0000` is +0000
		if (zone < -12 * 60 || zone > 14 * 60) raise('zone-range', t.from, t.to, 'time_error');
	}
	// Time.mktime / Time.utc refuse a day of 0 or past 31 (Ruby ArgumentError, not a TjException).
	if (day < 1 || day > 31) raise('day-range', t.from, t.to, null, { got: day });
	return { year, month, day, hour, minute, second, zone };
}

export function readDateExpr(c: Cursor): DateExpr {
	if (!c.eat('%')) return { kind: 'date', date: dateFromToken(c.expect('date')) };
	c.expectLiteral('{');
	const base = dateFromToken(c.expect('date'));
	const op = c.next();
	if (op === null) return raise('unexpected-end', c.end, c.end);
	if (op.kind !== 'literal' || (op.text !== '+' && op.text !== '-'))
		return raise('unexpected-token', op.from, op.to);
	const duration = readDuration(c);
	c.expectLiteral('}');
	return { kind: 'calc', base, sign: op.text, duration };
}

export function parseDate(text: string, base = 0): Parsed<DateExpr> {
	return parseWith(text, base, readDateExpr);
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

function validFields(d: TjDate): boolean {
	const ints = [d.year, d.month, d.day, d.hour, d.minute, d.second];
	return (
		ints.every(Number.isInteger) &&
		d.year >= 1970 &&
		d.year <= 2035 &&
		d.month >= 1 &&
		d.month <= 12 &&
		d.day >= 1 &&
		d.day <= 31 &&
		d.hour >= 0 &&
		d.hour <= 23 &&
		d.minute >= 0 &&
		d.minute <= 59 &&
		d.second >= 0 &&
		d.second <= 59 &&
		(d.zone === null || (Number.isInteger(d.zone) && d.zone >= -720 && d.zone <= 840))
	);
}

/** Canonical text: `2026-03-02`, `2026-03-02-09:30`, `2026-03-02-09:30:15--0500`. */
export function printTjDate(d: TjDate): Result<string> {
	if (!validFields(d)) return fail('unrepresentable', 0, 0);
	let s = `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;
	if (d.hour !== 0 || d.minute !== 0 || d.second !== 0 || d.zone !== null) {
		s += `-${pad(d.hour)}:${pad(d.minute)}`;
		if (d.second !== 0) s += `:${pad(d.second)}`;
		if (d.zone !== null) {
			const a = Math.abs(d.zone);
			s += `-${d.zone < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
		}
	}
	return ok(s);
}

/** Canonical text of a date or `%{ date ± duration }`. */
export function printDate(e: DateExpr): Result<string> {
	if (e.kind === 'date') return printTjDate(e.date);
	const b = printTjDate(e.base);
	if (!b.ok) return b;
	const d = printDuration(e.duration);
	return d.ok ? ok(`%{${b.value} ${e.sign} ${d.value}}`) : d;
}

export function sameTjDate(a: TjDate, b: TjDate): boolean {
	return (
		a.year === b.year &&
		a.month === b.month &&
		a.day === b.day &&
		a.hour === b.hour &&
		a.minute === b.minute &&
		a.second === b.second &&
		a.zone === b.zone
	);
}

export function sameDate(a: DateExpr, b: DateExpr): boolean {
	if (a.kind === 'date' || b.kind === 'date') {
		return a.kind === 'date' && b.kind === 'date' && sameTjDate(a.date, b.date);
	}
	return a.sign === b.sign && sameTjDate(a.base, b.base) && sameDuration(a.duration, b.duration);
}

/** The instant (epoch seconds) of a date, before the alignment check. */
export function dateEpoch(d: TjDate, env: ZoneEnv): Result<number> {
	if (d.zone !== null) return ok(utcSeconds(d) - d.zone * 60);
	const e = localToEpoch(d, env);
	return e === null ? fail('zone-data', 0, 0, null, { zone: env.zone ?? '' }) : ok(e);
}

/** The instant TaskJuggler gives a date value, with `rule_date`'s alignment check. */
export function resolveDate(e: DateExpr, ctx: ProjectContext): Result<number> {
	let epoch: number;
	if (e.kind === 'date') {
		const r = dateEpoch(e.date, ctx);
		if (!r.ok) return r;
		epoch = r.value;
	} else {
		const r = dateEpoch(e.base, ctx);
		if (!r.ok) return r;
		const d = intervalSeconds(e.duration, ctx);
		if (!d.ok) return d;
		epoch = r.value + (e.sign === '+' ? d.value : -d.value);
	}
	if (epoch % ctx.granularity !== 0) {
		return fail('misaligned-date', 0, 0, 'misaligned_date', { resolution: ctx.granularity / 60 });
	}
	return ok(epoch);
}

/** `valDate` (TjpSyntaxRules.rb:7504-7514): a date inside the project frame, ends included. */
export function resolveProjectDate(e: DateExpr, ctx: ProjectContext): Result<number> {
	const r = resolveDate(e, ctx);
	if (!r.ok || ctx.start === null || ctx.end === null) return r;
	if (r.value < ctx.start || r.value > ctx.end)
		return fail('out-of-project', 0, 0, 'date_in_range');
	return r;
}

/** Same as resolveDate, with the error placed on `span`. */
export function resolveDateAt(
	e: DateExpr,
	ctx: ProjectContext,
	span: { from: number; to: number },
): Result<number> {
	return at(resolveDate(e, ctx), span);
}

/**
 * The canonical date for an instant, as the app writes it: local time in the env's zone, or with
 * an explicit offset unless that local time names exactly this one instant. So a time in a DST
 * overlap (the first 01:30 on 2026-11-01 in New York) always carries its offset, whichever of
 * the two instants the engine's algorithm would pick. Null when zone data is missing or the year
 * is outside 1970..2035.
 */
export function dateFromEpoch(epoch: number, env: ZoneEnv): TjDate | null {
	const local = epochToLocal(epoch, env);
	if (local === null) return null;
	let d: TjDate = { ...local, zone: null };
	const instants = localInstants(local, env);
	const unique = instants !== null && instants.length === 1 && instants[0] === epoch;
	if (!unique || localToEpoch(local, env) !== epoch) {
		const off = offsetAt(env, epoch) ?? 0;
		d = { ...fieldsFromUtc(epoch + off), zone: Math.round(off / 60) };
	}
	return validFields(d) ? d : null;
}

/** Integer minutes since the project start, as views use them. */
export function minutesSince(epoch: number, startEpoch: number): number {
	return Math.floor((epoch - startEpoch) / 60);
}

/** The instant `minutes` after the project start. */
export function epochAt(minutes: number, startEpoch: number): number {
	return startEpoch + minutes * 60;
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Intervals (TjpSyntaxRules.rb:1979-2105, 7526-7614):
 * - `start - end`: the end must be after the start (`start_before_end`); an end date without a
 *   time is midnight, so that day is not included;
 * - `start +duration`: an interval duration (duration.ts);
 * - `start` alone, where the rule allows it (`intervalOrDate`, used by leaves and vacations):
 *   one day, to the same wall time on the next calendar day (`sameTimeNextDay`).
 * The `val…` variants also keep the interval inside the project frame (ProjectFileParser.rb:138-150).
 * Lists (`intervals`) are comma separated.
 */
import { sameTimeNextDay } from './civil';
import type { ProjectContext } from './context';
import { parseWith, type Cursor } from './cursor';
import { readDateExpr, printDate, resolveDate, sameDate, type DateExpr } from './date';
import {
	intervalSeconds,
	printDuration,
	readDuration,
	sameDuration,
	type Duration,
} from './duration';
import { fail, ok, raise, type Parsed, type Result, type Span } from './result';

export type IntervalEnd =
	| { readonly kind: 'date'; readonly date: DateExpr }
	| { readonly kind: 'duration'; readonly duration: Duration };

export interface Interval {
	readonly start: DateExpr;
	/** Null for the one-day form, which only `intervalOrDate` accepts. */
	readonly end: IntervalEnd | null;
}

/** Where the start and the end (sign included) were written. */
export interface IntervalSpans {
	readonly start: Span;
	readonly end: Span | null;
}

export function readInterval(c: Cursor, optionalEnd: boolean, spans?: IntervalSpans[]): Interval {
	const s0 = c.peek()?.from ?? c.end;
	const start = readDateExpr(c);
	const startSpan = { from: s0, to: c.offset };
	let end: IntervalEnd | null = null;
	const e0 = c.peek()?.from ?? c.end;
	if (c.eat('-')) {
		end = { kind: 'date', date: readDateExpr(c) };
	} else if (c.eat('+')) {
		end = { kind: 'duration', duration: readDuration(c) };
	} else if (!optionalEnd) {
		const t = c.peek();
		if (t === null) return raise('unexpected-end', c.end, c.end);
		return raise('unexpected-token', t.from, t.to);
	}
	spans?.push({ start: startSpan, end: end ? { from: e0, to: c.offset } : null });
	return { start, end };
}

export interface IntervalOptions {
	/** Accept a bare date (`intervalOrDate`). */
	readonly optionalEnd?: boolean;
}

export function parseInterval(
	text: string,
	base = 0,
	opts: IntervalOptions = {},
): Parsed<Interval, { spans: IntervalSpans }> {
	const spans: IntervalSpans[] = [];
	return parseWith(
		text,
		base,
		(c) => readInterval(c, opts.optionalEnd ?? false, spans),
		() => ({ spans: spans[0] ?? { start: { from: base, to: base }, end: null } }),
	);
}

export function readIntervalList(
	c: Cursor,
	optionalEnd: boolean,
	spans: IntervalSpans[],
): Interval[] {
	const list = [readInterval(c, optionalEnd, spans)];
	while (c.eat(',')) list.push(readInterval(c, optionalEnd, spans));
	return list;
}

/** `intervals`: `intervalOrDate (, intervalOrDate)*`. */
export function parseIntervals(
	text: string,
	base = 0,
	opts: IntervalOptions = { optionalEnd: true },
): Parsed<Interval[], { items: readonly IntervalSpans[] }> {
	const items: IntervalSpans[] = [];
	return parseWith(
		text,
		base,
		(c) => readIntervalList(c, opts.optionalEnd ?? true, items),
		() => ({ items }),
	);
}

/** Canonical text: `2026-01-05 - 2026-01-09`, `2026-11-26 +2d`, `2026-02-09`. */
export function printInterval(iv: Interval): Result<string> {
	const s = printDate(iv.start);
	if (!s.ok || iv.end === null) return s;
	const e = iv.end.kind === 'date' ? printDate(iv.end.date) : printDuration(iv.end.duration);
	if (!e.ok) return e;
	return ok(iv.end.kind === 'date' ? `${s.value} - ${e.value}` : `${s.value} +${e.value}`);
}

export function printIntervals(list: readonly Interval[]): Result<string> {
	const out: string[] = [];
	for (const iv of list) {
		const r = printInterval(iv);
		if (!r.ok) return r;
		out.push(r.value);
	}
	return out.length > 0 ? ok(out.join(', ')) : fail('unrepresentable', 0, 0);
}

export function sameInterval(a: Interval, b: Interval): boolean {
	if (!sameDate(a.start, b.start)) return false;
	if (a.end === null || b.end === null) return a.end === b.end;
	if (a.end.kind === 'date') return b.end.kind === 'date' && sameDate(a.end.date, b.end.date);
	return b.end.kind === 'duration' && sameDuration(a.end.duration, b.end.duration);
}

/**
 * The half-open instant range `[start, end)` TaskJuggler builds, in epoch seconds.
 * `inProject` adds the `valInterval`/`valIntervalOrDate` frame check.
 */
export function resolveInterval(
	iv: Interval,
	ctx: ProjectContext,
	opts: { inProject?: boolean } = {},
): Result<readonly [number, number]> {
	const s = resolveDate(iv.start, ctx);
	if (!s.ok) return s;
	let end: number;
	if (iv.end === null) {
		const next = sameTimeNextDay(s.value, ctx);
		if (next === null) return fail('zone-data', 0, 0, null, { zone: ctx.zone ?? '' });
		end = next;
	} else if (iv.end.kind === 'duration') {
		const d = intervalSeconds(iv.end.duration, ctx);
		if (!d.ok) return d;
		end = s.value + d.value;
	} else {
		const e = resolveDate(iv.end.date, ctx);
		if (!e.ok) return e;
		if (!(s.value < e.value)) return fail('start-before-end', 0, 0, 'start_before_end');
		end = e.value;
	}
	if (opts.inProject && ctx.start !== null && ctx.end !== null) {
		if (s.value < ctx.start || s.value >= ctx.end)
			return fail('out-of-project', 0, 0, 'interval_start_in_range');
		if (end <= ctx.start || end > ctx.end)
			return fail('out-of-project', 0, 0, 'interval_end_in_range');
	}
	return ok([s.value, end] as const);
}

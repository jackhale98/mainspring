// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Typed values of the MVP keywords (phase-1 spec 5.3), one entry point per value kind:
 *
 * - `parseValue(kind, text, base)` gives the typed value or a structured error at an offset;
 * - `printValue(v)` gives canonical text, and `parseValue(v.kind, printValue(v))` deep-equals `v`
 *   for any value the app creates;
 * - `sameValue(a, b)` is semantic equality of parsed values (`5 d` and `5d` are the same,
 *   `5.0d` is not: Ruby reads it as a Float);
 * - `checkValue(keyword, v, ctx)` applies the checks TaskJuggler makes once it knows the project
 *   settings (alignment, ranges, zero durations).
 *
 * Spelling is kept by not rewriting: `keepOrPrint` returns the text as written when it already
 * means the new value. The edit API uses it for its `already-set` no-op (spec 7.1).
 */
import { checkZoneName } from './civil';
import type { ProjectContext } from './context';
import {
	printDate,
	parseDate,
	resolveDate,
	resolveProjectDate,
	sameDate,
	type DateExpr,
} from './date';
import {
	durationAmount,
	checkTimingResolution,
	parseDuration,
	parseTimingResolution,
	printDuration,
	printTimingResolution,
	sameDuration,
	type Duration,
	type DurationUse,
} from './duration';
import {
	parseId,
	parseIdList,
	parseTaskRef,
	printIdList,
	printTaskRef,
	sameTaskRef,
	isId,
	type TaskRef,
} from './ids';
import {
	parseInterval,
	parseIntervals,
	printInterval,
	printIntervals,
	resolveInterval,
	sameInterval,
	type Interval,
} from './interval';
import {
	parseLeaves,
	parseVacation,
	printLeaves,
	printVacation,
	sameLeave,
	sameVacation,
	type Leave,
	type Vacation,
} from './leave';
import {
	checkComplete,
	checkPriority,
	parseInteger,
	parseNumber,
	printNumber,
	sameNumber,
	int,
	type TjNumber,
} from './number';
import { at, fail, ok, type Parsed, type Result, type Span } from './result';
import { parseString, printString } from './string-literal';
import {
	parseWorkingHours,
	printWorkingHours,
	sameWorkingHours,
	type WorkingHours,
} from './workinghours';

export type TypedValue =
	| { readonly kind: 'duration'; readonly value: Duration }
	| { readonly kind: 'date'; readonly value: DateExpr }
	| { readonly kind: 'interval'; readonly value: Interval }
	| { readonly kind: 'intervals'; readonly value: readonly Interval[] }
	| { readonly kind: 'number'; readonly value: TjNumber }
	| { readonly kind: 'integer'; readonly value: number }
	| { readonly kind: 'string'; readonly value: string }
	| { readonly kind: 'id'; readonly value: string }
	| { readonly kind: 'idList'; readonly value: readonly string[] }
	| { readonly kind: 'taskRef'; readonly value: TaskRef }
	| { readonly kind: 'scheduling'; readonly value: 'asap' | 'alap' }
	| { readonly kind: 'workinghours'; readonly value: WorkingHours }
	| { readonly kind: 'leaves'; readonly value: readonly Leave[] }
	| { readonly kind: 'vacation'; readonly value: Vacation }
	| { readonly kind: 'timingresolution'; readonly value: number };

export type ValueKind = TypedValue['kind'];
type ValueOf<K extends ValueKind> = Extract<TypedValue, { kind: K }>['value'];

/** Value kinds of the MVP keywords' value slots (spec 5.3). */
export const KEYWORD_VALUE_KIND: Readonly<Record<string, ValueKind>> = {
	effort: 'duration',
	length: 'duration',
	duration: 'duration',
	gapduration: 'duration',
	gaplength: 'duration',
	start: 'date',
	end: 'date',
	minstart: 'date',
	maxend: 'date',
	now: 'date',
	scheduling: 'scheduling',
	priority: 'integer',
	complete: 'number',
	efficiency: 'number',
	rate: 'number',
	dailyworkinghours: 'number',
	yearlyworkingdays: 'number',
	timingresolution: 'timingresolution',
	note: 'string',
	email: 'string',
	timezone: 'string',
	timeformat: 'string',
	currency: 'string',
	flags: 'idList',
	responsible: 'idList',
	managers: 'idList',
	workinghours: 'workinghours',
	leaves: 'leaves',
	vacation: 'vacation',
};

function tag<K extends ValueKind>(kind: K, r: Parsed<ValueOf<K>, object>): Parsed<TypedValue> {
	if (!r.ok) return r;
	return { ok: true, value: { kind, value: r.value } as TypedValue, from: r.from, to: r.to };
}

function parseScheduling(text: string, base: number): Parsed<'asap' | 'alap'> {
	const r = parseId(text, base);
	if (!r.ok || r.value === 'asap' || r.value === 'alap') return r as Parsed<'asap' | 'alap'>;
	return fail('unexpected-token', r.from, r.to);
}

/** Parses value text (without the keyword) as `kind`. Offsets in errors are `base`-relative. */
export function parseValue(kind: ValueKind, text: string, base = 0): Parsed<TypedValue> {
	switch (kind) {
		case 'duration':
			return tag(kind, parseDuration(text, base));
		case 'date':
			return tag(kind, parseDate(text, base));
		case 'interval':
			return tag(kind, parseInterval(text, base));
		case 'intervals':
			return tag(kind, parseIntervals(text, base));
		case 'number':
			return tag(kind, parseNumber(text, base));
		case 'integer':
			return tag(kind, parseInteger(text, base));
		case 'string':
			return tag(kind, parseString(text, base));
		case 'id':
			return tag(kind, parseId(text, base));
		case 'idList':
			return tag(kind, parseIdList(text, base));
		case 'taskRef':
			return tag(kind, parseTaskRef(text, base));
		case 'scheduling':
			return tag(kind, parseScheduling(text, base));
		case 'workinghours':
			return tag(kind, parseWorkingHours(text, base));
		case 'leaves':
			return tag(kind, parseLeaves(text, base));
		case 'vacation':
			return tag(kind, parseVacation(text, base));
		case 'timingresolution':
			return tag(kind, parseTimingResolution(text, base));
	}
}

/** Canonical text of a value. */
export function printValue(v: TypedValue): Result<string> {
	switch (v.kind) {
		case 'duration':
			return printDuration(v.value);
		case 'date':
			return printDate(v.value);
		case 'interval':
			return printInterval(v.value);
		case 'intervals':
			return printIntervals(v.value);
		case 'number':
			return printNumber(v.value);
		case 'integer':
			return printNumber(int(v.value));
		case 'string':
			return printString(v.value);
		case 'id':
			return isId(v.value) ? ok(v.value) : fail('not-an-id', 0, 0);
		case 'idList':
			return printIdList(v.value);
		case 'taskRef':
			return printTaskRef(v.value);
		case 'scheduling':
			return ok(v.value);
		case 'workinghours':
			return printWorkingHours(v.value);
		case 'leaves':
			return printLeaves(v.value);
		case 'vacation':
			return printVacation(v.value);
		case 'timingresolution':
			return printTimingResolution(v.value);
	}
}

const sameList = <T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): boolean =>
	a.length === b.length && a.every((x, i) => i < b.length && eq(x, b[i] as T));

/** Semantic equality of two parsed values (spelling ignored, written structure kept). */
export function sameValue(a: TypedValue, b: TypedValue): boolean {
	switch (a.kind) {
		case 'duration':
			return b.kind === a.kind && sameDuration(a.value, b.value);
		case 'date':
			return b.kind === a.kind && sameDate(a.value, b.value);
		case 'interval':
			return b.kind === a.kind && sameInterval(a.value, b.value);
		case 'intervals':
			return b.kind === a.kind && sameList(a.value, b.value, sameInterval);
		case 'number':
			return b.kind === a.kind && sameNumber(a.value, b.value);
		case 'taskRef':
			return b.kind === a.kind && sameTaskRef(a.value, b.value);
		case 'idList':
			return b.kind === a.kind && sameList(a.value, b.value, (x, y) => x === y);
		case 'workinghours':
			return b.kind === a.kind && sameWorkingHours(a.value, b.value);
		case 'leaves':
			return b.kind === a.kind && sameList(a.value, b.value, sameLeave);
		case 'vacation':
			return b.kind === a.kind && sameVacation(a.value, b.value);
		case 'integer':
		case 'string':
		case 'id':
		case 'scheduling':
		case 'timingresolution':
			return b.kind === a.kind && a.value === b.value;
	}
}

/**
 * The text to write for `next` where `written` is the current value text: `written` itself when
 * it parses to the same value (the user's spelling stays), else the canonical text of `next`.
 */
export function keepOrPrint(
	written: string | null,
	next: TypedValue,
): Result<{ text: string; changed: boolean }> {
	if (written !== null) {
		const cur = parseValue(next.kind, written);
		if (cur.ok && sameValue(cur.value, next)) return ok({ text: written, changed: false });
	}
	const p = printValue(next);
	return p.ok ? ok({ text: p.value, changed: true }) : p;
}

const DURATION_USE: Readonly<Record<string, DurationUse>> = {
	effort: 'effort',
	length: 'length',
	gaplength: 'gaplength',
	duration: 'duration',
	gapduration: 'gapduration',
};

/**
 * TaskJuggler's context-dependent checks for a keyword's value; `span` places the error.
 * Dates of `start`, `end`, `minstart` and `maxend` must lie in the project frame (`valDate`);
 * a `timezone` must be 'UTC' or a known `Region/City` zone (`bad_time_zone`, needs `ctx.zones`).
 */
export function checkValue(
	keyword: string,
	v: TypedValue,
	ctx: ProjectContext,
	span: Span = { from: 0, to: 0 },
): Result<true> {
	const done = <T>(r: Result<T>): Result<true> => (r.ok ? ok(true) : (at(r, span) as Result<true>));
	switch (v.kind) {
		case 'duration': {
			const use = DURATION_USE[keyword];
			return use ? done(durationAmount(v.value, use, ctx)) : ok(true);
		}
		case 'date':
			return ['start', 'end', 'minstart', 'maxend'].includes(keyword)
				? done(resolveProjectDate(v.value, ctx))
				: done(resolveDate(v.value, ctx));
		case 'interval':
			return done(resolveInterval(v.value, ctx));
		case 'intervals':
			for (const iv of v.value) {
				const r = resolveInterval(iv, ctx);
				if (!r.ok) return done(r);
			}
			return ok(true);
		case 'leaves':
			for (const l of v.value) {
				const r = resolveInterval(l.interval, ctx);
				if (!r.ok) return done(r);
			}
			return ok(true);
		case 'vacation':
			return checkValue(keyword, { kind: 'intervals', value: v.value.intervals }, ctx, span);
		case 'number':
			return keyword === 'complete' ? done(checkComplete(v.value)) : ok(true);
		case 'integer':
			return keyword === 'priority' ? done(checkPriority(v.value)) : ok(true);
		case 'timingresolution':
			return done(checkTimingResolution(v.value));
		case 'string':
			return keyword === 'timezone' ? done(checkZoneName(v.value, ctx.zones)) : ok(true);
		default:
			return ok(true);
	}
}

export * from './civil';
export * from './context';
export * from './date';
export * from './duration';
export * from './ids';
export * from './interval';
export * from './leave';
export * from './number';
export * from './result';
export * from './string-literal';
export * from './workinghours';
export { ValueLexer, hasExpansion, type Token, type TokenKind } from './lex';

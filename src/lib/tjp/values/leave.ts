// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Leaves and vacations.
 *
 * `leaves` takes `leave (, leave)*`; a leave is `leaveType STRING? intervalOrDate`
 * (TjpSyntaxRules.rb:2301-2395), e.g. `holiday "Thanksgiving" 2026-11-26 +2d`. Leave intervals
 * are not range checked. `vacation` (:3666, 5023, 5368) is `STRING? intervals`; TaskJuggler
 * throws the name away, and a shift's vacation may have no interval at all.
 */
import { parseWith, type Cursor } from './cursor';
import { parseDate } from './date';
import { parseDuration } from './duration';
import {
	printInterval,
	printIntervals,
	readInterval,
	readIntervalList,
	sameInterval,
	type Interval,
	type IntervalSpans,
} from './interval';
import { fail, ok, raise, type Parsed, type Result, type Span } from './result';
import { printString } from './string-literal';

export const LEAVE_TYPES = [
	'project',
	'annual',
	'special',
	'sick',
	'unpaid',
	'holiday',
	'unemployed',
] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export interface Leave {
	readonly type: LeaveType;
	readonly name: string | null;
	readonly interval: Interval;
}

const isLeaveType = (s: string): s is LeaveType => (LEAVE_TYPES as readonly string[]).includes(s);

export interface LeaveSpans {
	/** The whole item. */
	readonly item: Span;
	readonly name: Span | null;
	readonly interval: IntervalSpans;
}

function readName(c: Cursor): { name: string | null; span: Span | null } {
	const t = c.peek();
	if (t?.kind !== 'string') return { name: null, span: null };
	c.next();
	return { name: t.str?.value ?? '', span: { from: t.from, to: t.to } };
}

function readLeave(c: Cursor, spans: LeaveSpans[]): Leave {
	const t = c.expect('id');
	if (!isLeaveType(t.text)) raise('unexpected-token', t.from, t.to);
	const { name, span } = readName(c);
	const ivSpans: IntervalSpans[] = [];
	const interval = readInterval(c, true, ivSpans);
	const iv = ivSpans[0] ?? { start: { from: t.from, to: t.to }, end: null };
	spans.push({ item: { from: t.from, to: c.offset }, name: span, interval: iv });
	return { type: t.text as LeaveType, name, interval };
}

/** Parses the text after the `leaves` keyword. */
export function parseLeaves(
	text: string,
	base = 0,
): Parsed<Leave[], { items: readonly LeaveSpans[] }> {
	const items: LeaveSpans[] = [];
	return parseWith(
		text,
		base,
		(c) => {
			const list = [readLeave(c, items)];
			while (c.eat(',')) list.push(readLeave(c, items));
			return list;
		},
		() => ({ items }),
	);
}

/** `holiday "Founders day" 2026-02-09`. */
export function printLeave(l: Leave): Result<string> {
	const iv = printInterval(l.interval);
	if (!iv.ok) return iv;
	if (l.name === null) return ok(`${l.type} ${iv.value}`);
	const name = printString(l.name);
	return name.ok ? ok(`${l.type} ${name.value} ${iv.value}`) : name;
}

export function printLeaves(list: readonly Leave[]): Result<string> {
	const out: string[] = [];
	for (const l of list) {
		const r = printLeave(l);
		if (!r.ok) return r;
		out.push(r.value);
	}
	return out.length > 0 ? ok(out.join(', ')) : fail('unrepresentable', 0, 0);
}

export const sameLeave = (a: Leave, b: Leave): boolean =>
	a.type === b.type && a.name === b.name && sameInterval(a.interval, b.interval);

export interface Vacation {
	readonly name: string | null;
	readonly intervals: readonly Interval[];
}

/** Parses the text after `vacation`; `allowEmpty` for a shift's `intervalsOptional`. */
export function parseVacation(
	text: string,
	base = 0,
	opts: { allowEmpty?: boolean } = {},
): Parsed<Vacation, { items: readonly IntervalSpans[] }> {
	const items: IntervalSpans[] = [];
	return parseWith(
		text,
		base,
		(c) => {
			const { name } = readName(c);
			if (opts.allowEmpty && c.peek() === null) return { name, intervals: [] };
			return { name, intervals: readIntervalList(c, true, items) };
		},
		() => ({ items }),
	);
}

export function printVacation(v: Vacation): Result<string> {
	const name = v.name === null ? ok('') : printString(v.name);
	if (!name.ok) return name;
	if (v.intervals.length === 0) return v.name === null ? fail('unrepresentable', 0, 0) : name;
	const ivs = printIntervals(v.intervals);
	if (!ivs.ok) return ivs;
	return ok(v.name === null ? ivs.value : `${name.value} ${ivs.value}`);
}

export const sameVacation = (a: Vacation, b: Vacation): boolean =>
	a.name === b.name &&
	a.intervals.length === b.intervals.length &&
	a.intervals.every((iv, i) => {
		const other = b.intervals[i];
		return other !== undefined && sameInterval(iv, other);
	});

/** The edit API's `LeaveSpec` (spec 6.5): `start` is a date, `end` a date or `+2d`. */
export interface LeaveSpec {
	readonly type: LeaveType;
	readonly name?: string;
	readonly start: string;
	readonly end?: string;
}

/** Validates a LeaveSpec's texts and builds the Leave. */
export function leaveFromSpec(spec: LeaveSpec): Result<Leave> {
	if (!isLeaveType(spec.type)) return fail('unexpected-token', 0, 0);
	if (spec.name !== undefined) {
		const n = printString(spec.name);
		if (!n.ok) return n;
	}
	const start = parseDate(spec.start);
	if (!start.ok) return start;
	let interval: Interval = { start: start.value, end: null };
	if (spec.end !== undefined) {
		const t = spec.end.trimStart();
		if (t.startsWith('+')) {
			const d = parseDuration(t.slice(1));
			if (!d.ok) return d;
			interval = { start: start.value, end: { kind: 'duration', duration: d.value } };
		} else {
			const e = parseDate(spec.end);
			if (!e.ok) return e;
			interval = { start: start.value, end: { kind: 'date', date: e.value } };
		}
	}
	return ok({ type: spec.type, name: spec.name ?? null, interval });
}

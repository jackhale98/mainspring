// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test-only fast-check arbitraries for typed values, and a "messy" printer that writes the same
 * value with other spellings: unpadded dates, other quotes, leading zeros, and whitespace or
 * comments between tokens. Not imported by application code.
 *
 * Tokens are glued without trivia only where TaskJuggler's scanner keeps them apart. A date is
 * never glued to a following '-': `2026-01-05-09:00-2026-01-09` would read `-2026` as a zone.
 * Block comments always end their line, since a one-line block comment runs to the last `*\/`.
 */
import fc from 'fast-check';
import { lastDayOfMonth } from '../civil';
import type { DateExpr, TjDate } from '../date';
import { DURATION_UNITS, TIMING_RESOLUTIONS, type Duration } from '../duration';
import type { TaskRef } from '../ids';
import type { Interval } from '../interval';
import { LEAVE_TYPES, type Leave, type Vacation } from '../leave';
import { float, int, plainDecimal, type TjNumber } from '../number';
import type { TypedValue, ValueKind } from '../index';
import { isSafeText, printString } from '../string-literal';
import { WEEKDAYS, type WorkingHours } from '../workinghours';

const num: fc.Arbitrary<TjNumber> = fc.oneof(
	fc.nat({ max: 100000 }).map(int),
	fc
		.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true })
		.filter((x) => !Object.is(x, -0))
		.map(float),
);
const duration: fc.Arbitrary<Duration> = fc.record({
	amount: num,
	unit: fc.constantFrom(...DURATION_UNITS),
});
const tjDate: fc.Arbitrary<TjDate> = fc
	.record({
		year: fc.integer({ min: 1970, max: 2035 }),
		month: fc.integer({ min: 1, max: 12 }),
		day: fc.integer({ min: 1, max: 31 }),
		hour: fc.integer({ min: 0, max: 23 }),
		minute: fc.integer({ min: 0, max: 59 }),
		second: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 59 })),
		zone: fc.option(fc.integer({ min: -720, max: 840 }), { freq: 3 }),
	})
	.map((d) => ({ ...d, day: Math.min(d.day, lastDayOfMonth(d.month, d.year)) }));
const dateExpr: fc.Arbitrary<DateExpr> = fc.oneof(
	{ weight: 3, arbitrary: tjDate.map((date) => ({ kind: 'date' as const, date })) },
	fc.record({
		kind: fc.constant('calc' as const),
		base: tjDate,
		sign: fc.constantFrom('+' as const, '-' as const),
		duration,
	}),
);
const intervalOf = (optionalEnd: boolean): fc.Arbitrary<Interval> =>
	fc.record({
		start: dateExpr,
		end: fc.oneof(
			...(optionalEnd ? [fc.constant(null)] : []),
			dateExpr.map((date) => ({ kind: 'date' as const, date })),
			duration.map((d) => ({ kind: 'duration' as const, duration: d })),
		),
	});
const text: fc.Arbitrary<string> = fc
	.oneof(
		fc.string({ maxLength: 12 }),
		fc
			.array(
				fc.constantFrom(
					'a',
					' ',
					'"',
					"'",
					'\\',
					'\n',
					'\r',
					'$',
					'{',
					'#',
					'/*',
					'é',
					'🎉',
					'->8-',
				),
				{ maxLength: 10 },
			)
			.map((a) => a.join('')),
	)
	// Values the app creates break lines with `\n`, as TaskJuggler reads every break.
	.map((s) => s.replace(/\r\n?/g, '\n'))
	.filter((s) => isSafeText(s) && !s.endsWith('\\'));
const id = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,6}$/);
const taskRef: fc.Arbitrary<TaskRef> = fc.record({
	up: fc.nat({ max: 3 }),
	path: fc.array(id, { minLength: 1, maxLength: 3 }).map((p) => p.join('.')),
});
const workingHours: fc.Arbitrary<WorkingHours> = fc.record({
	days: fc.subarray([...WEEKDAYS], { minLength: 1 }),
	hours: fc.array(
		fc
			.integer({ min: 0, max: 1439 })
			.chain((s) => fc.integer({ min: s + 1, max: 1440 }).map((e) => [s, e] as const)),
		{ maxLength: 3 },
	),
});
const leave: fc.Arbitrary<Leave> = fc.record({
	type: fc.constantFrom(...LEAVE_TYPES),
	name: fc.option(text),
	interval: intervalOf(true),
});
const vacation: fc.Arbitrary<Vacation> = fc.record({
	name: fc.option(text),
	intervals: fc.array(intervalOf(true), { minLength: 1, maxLength: 3 }),
});

const as = <K extends ValueKind>(
	kind: K,
	arb: fc.Arbitrary<Extract<TypedValue, { kind: K }>['value']>,
) => arb.map((value) => ({ kind, value }) as TypedValue);

/** One arbitrary of canonical (app-created) values per kind. */
export const arbitraries: Readonly<Record<ValueKind, fc.Arbitrary<TypedValue>>> = {
	duration: as('duration', duration),
	date: as('date', dateExpr),
	interval: as('interval', intervalOf(false)),
	intervals: as('intervals', fc.array(intervalOf(true), { minLength: 1, maxLength: 3 })),
	number: as('number', num),
	integer: as('integer', fc.nat({ max: 1_000_000 })),
	string: as('string', text),
	id: as('id', id),
	idList: as('idList', fc.array(id, { minLength: 1, maxLength: 4 })),
	taskRef: as('taskRef', taskRef),
	scheduling: as('scheduling', fc.constantFrom('asap' as const, 'alap' as const)),
	workinghours: as('workinghours', workingHours),
	leaves: as('leaves', fc.array(leave, { minLength: 1, maxLength: 3 })),
	vacation: as('vacation', vacation),
	timingresolution: as('timingresolution', fc.constantFrom(...TIMING_RESOLUTIONS)),
};

// ---- the messy printer ----

export interface Variant {
	readonly seed: readonly number[];
}
type Kind = 'num' | 'unit' | 'date' | 'time' | 'word' | 'string' | 'p';
interface Tok {
	readonly kind: Kind;
	readonly text: string;
}

const TRIVIA = [' ', '  ', '\t', '\n', ' # note\n', ' // note\n', ' /* note */\n', '\n\t '];

class Chooser {
	private i = 0;
	constructor(private readonly seed: readonly number[]) {}
	pick(n: number): number {
		const v = this.seed[this.i++ % this.seed.length] ?? 0;
		return v % n;
	}
	coin(): boolean {
		return this.pick(2) === 0;
	}
}

const p = (t: string): Tok => ({ kind: 'p', text: t });

function glue(a: Tok, b: Tok): boolean {
	if (a.kind === 'num' && b.kind === 'unit') return true;
	if (a.kind === 'date' && b.kind === 'p' && b.text === '-') return false;
	if (a.kind === 'p' || b.kind === 'p') return true;
	return a.kind === 'string' || b.kind === 'string';
}

function numToks(n: TjNumber, c: Chooser): Tok {
	if (!n.float) return { kind: 'num', text: (c.coin() ? '0' : '') + String(n.value) };
	let s = plainDecimal(n.value);
	if (!s.includes('.')) s += '.0';
	if (c.coin()) s += '0';
	if (s.startsWith('0.') && c.coin()) s = s.slice(1);
	return { kind: 'num', text: s };
}

function dateTok(d: TjDate, c: Chooser): Tok {
	const two = (n: number) => (c.coin() ? String(n).padStart(2, '0') : String(n));
	let s = `${d.year}-${two(d.month)}-${two(d.day)}`;
	const midnight = d.hour === 0 && d.minute === 0 && d.second === 0 && d.zone === null;
	if (!midnight || c.coin()) {
		s += `-${two(d.hour)}:${two(d.minute)}`;
		if (d.second !== 0 || (c.coin() && d.zone === null)) s += `:${two(d.second)}`;
		if (d.zone !== null) {
			const a = Math.abs(d.zone);
			const sign = d.zone < 0 || (d.zone === 0 && c.coin()) ? '-' : '+';
			s += `-${sign}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
		}
	}
	return { kind: 'date', text: s };
}

const durToks = (d: Duration, c: Chooser): Tok[] => [
	numToks(d.amount, c),
	{ kind: 'unit', text: d.unit },
];

function dateExprToks(e: DateExpr, c: Chooser): Tok[] {
	if (e.kind === 'date') return [dateTok(e.date, c)];
	return [p('%'), p('{'), dateTok(e.base, c), p(e.sign), ...durToks(e.duration, c), p('}')];
}

function intervalToks(iv: Interval, c: Chooser): Tok[] {
	const start = dateExprToks(iv.start, c);
	if (iv.end === null) return start;
	if (iv.end.kind === 'date') return [...start, p('-'), ...dateExprToks(iv.end.date, c)];
	return [...start, p('+'), ...durToks(iv.end.duration, c)];
}

function stringTok(s: string, c: Chooser): Tok {
	const styles = [c.coin() ? 'single' : 'double', 'cut'] as const;
	const style = s.endsWith('\n') && c.pick(3) === 0 ? styles[1] : styles[0];
	const r = printString(s, { style, indent: c.coin() ? '  ' : '' });
	const out = r.ok ? r.value : (printString(s) as { ok: true; value: string }).value;
	return { kind: 'string', text: out };
}

const commaJoin = (groups: Tok[][]): Tok[] =>
	groups.flatMap((g, i) => (i === 0 ? g : [p(','), ...g]));

function dayToks(days: readonly string[], c: Chooser): Tok[][] {
	const items: Tok[][] = [];
	let i = 0;
	while (i < WEEKDAYS.length) {
		const d = WEEKDAYS[i] as string;
		if (!days.includes(d)) {
			i++;
			continue;
		}
		let j = i;
		while (j + 1 < WEEKDAYS.length && days.includes(WEEKDAYS[j + 1] as string)) j++;
		if (j > i && c.coin())
			items.push([
				{ kind: 'word', text: d },
				p('-'),
				{ kind: 'word', text: WEEKDAYS[j] as string },
			]);
		else for (let k = i; k <= j; k++) items.push([{ kind: 'word', text: WEEKDAYS[k] as string }]);
		i = j + 1;
	}
	const r = c.pick(items.length);
	return [...items.slice(r), ...items.slice(0, r)];
}

const timeTok = (m: number, c: Chooser): Tok => ({
	kind: 'time',
	text: `${c.coin() ? String(Math.floor(m / 60)).padStart(2, '0') : Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`,
});

function toks(v: TypedValue, c: Chooser): Tok[] {
	switch (v.kind) {
		case 'duration':
			return durToks(v.value, c);
		case 'date':
			return dateExprToks(v.value, c);
		case 'interval':
			return intervalToks(v.value, c);
		case 'intervals':
			return commaJoin(v.value.map((iv) => intervalToks(iv, c)));
		case 'number':
			return [numToks(v.value, c)];
		case 'integer':
			return [numToks(int(v.value), c)];
		case 'string':
			return [stringTok(v.value, c)];
		case 'id':
		case 'scheduling':
			return [{ kind: 'word', text: v.value }];
		case 'idList':
			return commaJoin(v.value.map((x) => [{ kind: 'word' as const, text: x }]));
		case 'taskRef':
			return [
				...Array.from({ length: v.value.up }, () => p('!')),
				{ kind: 'word', text: v.value.path },
			];
		case 'workinghours': {
			const hours = v.value.hours.map(([s, e]) => [timeTok(s, c), p('-'), timeTok(e, c)]);
			const times =
				hours.length === 0 ? [{ kind: 'word' as const, text: 'off' }] : commaJoin(hours);
			return [...commaJoin(dayToks(v.value.days, c)), ...times];
		}
		case 'leaves':
			return commaJoin(
				v.value.map((l) => [
					{ kind: 'word' as const, text: l.type },
					...(l.name === null ? [] : [stringTok(l.name, c)]),
					...intervalToks(l.interval, c),
				]),
			);
		case 'timingresolution':
			return [numToks(int(v.value), c), { kind: 'unit', text: 'min' }];
		case 'vacation':
			return [
				...(v.value.name === null ? [] : [stringTok(v.value.name, c)]),
				...commaJoin(v.value.intervals.map((iv) => intervalToks(iv, c))),
			];
	}
}

/** The value written with another spelling, chosen by `how`. */
export function messy(v: TypedValue, how: Variant): string {
	const c = new Chooser(how.seed);
	const list = toks(v, c);
	let out = c.coin() ? (TRIVIA[c.pick(TRIVIA.length)] ?? '') : '';
	list.forEach((t, i) => {
		const prev = list[i - 1];
		if (prev) out += glue(prev, t) && c.coin() ? '' : (TRIVIA[c.pick(TRIVIA.length)] ?? ' ');
		out += t.text;
	});
	return out + (c.coin() ? ' # trailing\n' : '');
}

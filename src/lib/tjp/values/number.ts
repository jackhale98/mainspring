// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Numbers: TaskJuggler's `number` rule is `$INTEGER | $FLOAT` (TjpSyntaxRules.rb:2932), lexed as
 * `\d+` and `\d*\.\d+` (ProjectFileScanner.rb:94-97). There is no sign: '-' is a literal.
 *
 * Whether a number was written as an integer or a float is part of its value, because Ruby
 * arithmetic differs: `45min` of effort is `45 * 60 / 3600 = 0` slots (integer division), but
 * `45.0min` is `0.75.round = 1` slot (TjpSyntaxRules.rb:7667-7684). So `TjNumber` keeps `float`,
 * `printNumber` writes `2.0` for a float two, and the helpers below follow Ruby's rules.
 */
import type { Cursor } from './cursor';
import { parseWith } from './cursor';
import type { Token } from './lex';
import { fail, ok, raise, type Parsed, type Result } from './result';

export interface TjNumber {
	readonly value: number;
	/** True for a `$FLOAT` token (or a Ruby Float result). */
	readonly float: boolean;
}

export const int = (value: number): TjNumber => ({ value, float: false });
export const float = (value: number): TjNumber => ({ value, float: true });

/** The number a `$INTEGER` or `$FLOAT` token holds. Integers past 2^53 are refused. */
export function numberFromToken(t: Token): TjNumber {
	if (t.kind === 'float') return float(Number(t.text));
	const value = Number(t.text);
	if (!Number.isSafeInteger(value)) raise('number-too-large', t.from, t.to);
	return int(value);
}

export function readNumber(c: Cursor): TjNumber {
	return numberFromToken(c.expect('integer', 'float'));
}

export function readInteger(c: Cursor): number {
	return numberFromToken(c.expect('integer')).value;
}

export function parseNumber(text: string, base = 0): Parsed<TjNumber> {
	return parseWith(text, base, readNumber);
}

export function parseInteger(text: string, base = 0): Parsed<number> {
	return parseWith(text, base, readInteger);
}

/** A finite, non-negative double as plain decimal digits (never exponent notation). */
export function plainDecimal(x: number): string {
	const s = String(x);
	const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
	if (!m) return s;
	const frac = m[2] ?? '';
	const digits = (m[1] ?? '') + frac;
	const exp = Number(m[3]) - frac.length; // value = digits * 10^exp
	if (exp >= 0) return digits + '0'.repeat(exp);
	const point = digits.length + exp;
	return point > 0
		? `${digits.slice(0, point)}.${digits.slice(point)}`
		: `0.${'0'.repeat(-point)}${digits}`;
}

/** Canonical text: `5`, `0.5`, `2.0`. Negative, non-finite or unsafe numbers cannot be written. */
export function printNumber(n: TjNumber): Result<string> {
	const { value } = n;
	if (!Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
		return fail('unrepresentable', 0, 0, null, { value: String(value) });
	}
	if (!n.float) {
		if (!Number.isSafeInteger(value)) return fail('unrepresentable', 0, 0, null, { value });
		return ok(String(value));
	}
	const s = plainDecimal(value);
	return ok(s.includes('.') ? s : `${s}.0`);
}

export function sameNumber(a: TjNumber, b: TjNumber): boolean {
	return a.float === b.float && a.value === b.value;
}

// Ruby numeric semantics for the duration conversions (Integer op Integer stays Integer).

export function rMul(a: TjNumber, b: TjNumber): TjNumber {
	return { value: a.value * b.value, float: a.float || b.float };
}

/** Ruby `/`: floor division for two Integers, else float division. */
export function rDiv(a: TjNumber, b: TjNumber): TjNumber {
	if (!a.float && !b.float) return int(Math.floor(a.value / b.value));
	return float(a.value / b.value);
}

/** Ruby `round` then `to_i` for a non-negative number (half away from zero). */
export function rRound(a: TjNumber): number {
	return a.float ? Math.round(a.value) : a.value;
}

/** Ruby `to_i`: truncation toward zero. */
export function rToI(a: TjNumber): number {
	return Math.trunc(a.value);
}

/** Range checks TaskJuggler applies to number-valued attributes. */
export function checkRange(
	value: number,
	min: number,
	max: number,
	tj: string,
	at: { from: number; to: number } = { from: 0, to: 0 },
): Result<number> {
	if (value < min || value > max)
		return fail('number-range', at.from, at.to, tj, { min, max, got: value });
	return ok(value);
}

/** `complete` (TjpSyntaxRules.rb:6323-6328): 0 to 100. */
export const checkComplete = (n: TjNumber): Result<number> =>
	checkRange(n.value, 0, 100, 'task_complete');

/** `priority` (TjpSyntaxRules.rb:6615-6620): an integer, 0 to 1000. */
export const checkPriority = (n: number): Result<number> => checkRange(n, 0, 1000, 'task_priority');

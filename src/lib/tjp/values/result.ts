// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Shared result and error types for typed TJP values (phase-1 spec 5.3, T6).
 *
 * Errors are structured, not prose: user-facing copy lives in `src/lib/strings.ts`, which maps
 * `code` (and `tj`, TaskJuggler's own message id where one exists) to text. Offsets are UTF-16
 * offsets into the parsed text plus the caller's `base`, so they can be file offsets directly.
 */

export type ValueErrorCode =
	// Lexical and structural
	| 'unexpected-token'
	| 'unexpected-end'
	| 'trailing-text'
	| 'macro-call'
	| 'env-var'
	| 'unterminated'
	| 'junk-after-cut'
	// Numbers and durations
	| 'bad-unit'
	| 'number-range'
	| 'number-too-large'
	| 'zero-duration'
	| 'duration-not-aligned'
	| 'duration-too-small'
	// Dates and times
	| 'year-range'
	| 'month-range'
	| 'day-range'
	| 'hour-range'
	| 'minute-range'
	| 'second-range'
	| 'zone-sign'
	| 'zone-format'
	| 'zone-range'
	| 'time-range'
	| 'time-interval'
	| 'misaligned-date'
	| 'start-before-end'
	| 'out-of-project'
	| 'zone-data'
	| 'bad-zone'
	// Ids
	| 'not-an-id'
	| 'too-many-bangs'
	// Printing
	| 'unsafe-text'
	| 'unrepresentable';

export interface ValueError {
	readonly code: ValueErrorCode;
	readonly from: number;
	readonly to: number;
	/** TaskJuggler's message id for the same condition (e.g. 'misaligned_date'), if it has one. */
	readonly tj: string | null;
	/** Values for the message template, e.g. `{ min: 1970, max: 2035, got: 1969 }`. */
	readonly args: Readonly<Record<string, string | number>>;
}

export interface Span {
	readonly from: number;
	readonly to: number;
}

export type Result<T> =
	{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ValueError };

/** A parsed value with the range it covers (trivia around it excluded). */
export type Parsed<T, Extra = object> =
	| ({ readonly ok: true; readonly value: T; readonly from: number; readonly to: number } & Extra)
	| { readonly ok: false; readonly error: ValueError };

export function ok<T>(value: T): Result<T> {
	return { ok: true, value };
}

export function valueError(
	code: ValueErrorCode,
	from: number,
	to: number,
	tj: string | null = null,
	args: Readonly<Record<string, string | number>> = {},
): ValueError {
	return { code, from, to, tj, args };
}

export function fail(
	code: ValueErrorCode,
	from: number,
	to: number,
	tj: string | null = null,
	args: Readonly<Record<string, string | number>> = {},
): { readonly ok: false; readonly error: ValueError } {
	return { ok: false, error: valueError(code, from, to, tj, args) };
}

/** Moves a semantic check's error (reported at 0..0) onto the value's range. */
export function at<T>(r: Result<T>, span: Span): Result<T> {
	return r.ok ? r : { ok: false, error: { ...r.error, from: span.from, to: span.to } };
}

/** Thrown inside the recursive-descent parsers; caught at each public entry point. */
export class ValueParseError extends Error {
	constructor(readonly error: ValueError) {
		super(error.code);
		this.name = 'ValueParseError';
	}
}

export function raise(
	code: ValueErrorCode,
	from: number,
	to: number,
	tj: string | null = null,
	args: Readonly<Record<string, string | number>> = {},
): never {
	throw new ValueParseError(valueError(code, from, to, tj, args));
}

/** Runs a parser body and turns a thrown ValueParseError into `{ ok: false }`. */
export function capture<R>(body: () => R): R | { readonly ok: false; readonly error: ValueError } {
	try {
		return body();
	} catch (e) {
		if (e instanceof ValueParseError) return { ok: false, error: e.error };
		throw e;
	}
}

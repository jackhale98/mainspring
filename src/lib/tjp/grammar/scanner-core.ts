// SPDX-License-Identifier: GPL-2.0-only
// Port of TaskJuggler's macro-call patterns and runaway handling, from
// engine/tj/lib/taskjuggler/ProjectFileScanner.rb and TextParser/Scanner.rb at 3b36c79.
/**
 * Shared pieces of the scanner port (`scanner.ts`, `scanner-strings.ts`): the input interface,
 * the token record, regex helpers and TaskJuggler's `macroCall` mode.
 */
import type { TjpScanError, TjpTokenKind } from './token-kinds';

/**
 * Access to the input, relative to the start of the token being scanned. The scanner reads
 * only what TaskJuggler's patterns need: the token itself for most tokens, and the rest of the
 * line where a pattern looks there (comments, macro bodies, cut marks, macro calls).
 */
export interface ScanSource {
	/** The code unit at `offset`, or -1 at the end of input. */
	peek(offset: number): number;
	/** `length` code units from `offset`, fewer at the end of input. */
	slice(offset: number, length: number): string;
	/** From `offset` to the end of its line, including the `\n`; '' at the end of input. */
	line(offset: number): string;
}

/** One scanned token, relative to where scanning started. */
export interface ScannedToken {
	readonly kind: TjpTokenKind;
	/** Length in UTF-16 code units, at least 1. */
	readonly length: number;
	readonly flags: number;
	readonly error: TjpScanError | null;
}

export const LF = 10;

// Ruby `\s` is [ \t\n\v\f\r]; `.` is [^\n]. All patterns are sticky: anchored at lastIndex.
export const RE_MACRO_HEAD = /\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]\w*(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*/y;
const RE_CALL_END = /(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*[ \t\n\v\f\r]*\}/y;

/** Length of the match of sticky `re` at `index` in `s`, or -1. */
export function match(re: RegExp, s: string, index = 0): number {
	re.lastIndex = index;
	return re.test(s) ? re.lastIndex - index : -1;
}

export function endsLine(s: string): boolean {
	return s.charCodeAt(s.length - 1) === LF;
}

export function token(kind: TjpTokenKind, length: number, flags = 0): ScannedToken {
	return { kind, length, flags, error: null };
}

/** An error token from the token start to the end of the input (`runaway_token`). */
export function runaway(
	src: ScanSource,
	from: number,
	error: TjpScanError,
	flags = 0,
): ScannedToken {
	let pos = from;
	for (let line = src.line(pos); line !== ''; line = src.line(pos)) pos += line.length;
	return { kind: 'Error', length: pos, flags, error };
}

/** `macroCall` mode from `from`, just after the call head: the end, or -1 at the end of input. */
export function finishCall(src: ScanSource, from: number): number {
	let pos = from;
	for (;;) {
		const line = src.line(pos);
		if (line === '') return -1;
		const n = match(RE_CALL_END, line);
		if (n >= 0) return pos + n;
		if (!endsLine(line)) return -1;
		pos += line.length;
	}
}

/** A {@link ScanSource} over a string, for tokens starting at `base`. */
export class StringSource implements ScanSource {
	base = 0;
	private readonly text: string;
	/** The first `\n` at or after `nlFrom`, or the text length. */
	private nl = -1;
	private nlFrom = 0;

	constructor(text: string) {
		this.text = text;
	}

	peek(offset: number): number {
		const abs = this.base + offset;
		return abs < this.text.length ? this.text.charCodeAt(abs) : -1;
	}

	slice(offset: number, length: number): string {
		const abs = this.base + offset;
		return this.text.slice(abs, abs + length);
	}

	line(offset: number): string {
		const abs = this.base + offset;
		const text = this.text;
		if (abs >= text.length) return '';
		if (abs < this.nlFrom || abs > this.nl) {
			const nl = text.indexOf('\n', abs);
			this.nl = nl < 0 ? text.length : nl;
			this.nlFrom = abs;
		}
		return text.slice(abs, this.nl + 1);
	}
}

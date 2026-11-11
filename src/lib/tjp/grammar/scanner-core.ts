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
 *
 * Line breaks are `\n`, `\r\n` or a lone `\r`. TaskJuggler reads files through
 * `forceUTF8Encoding` (`encode('UTF-8', universal_newline: true)`, UTF8String.rb, called from
 * FileStreamHandle in TextParser/Scanner.rb), which turns both `\r\n` and `\r` into `\n` before
 * scanning; the port keeps the original text and treats all three as one break.
 */
export interface ScanSource {
	/** The code unit at `offset`, or -1 at the end of input. */
	peek(offset: number): number;
	/** `length` code units from `offset`, fewer at the end of input. */
	slice(offset: number, length: number): string;
	/** From `offset` to the end of its line, including its break; '' at the end of input. */
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
export const CR = 13;

// Ruby `\s` is [ \t\n\v\f\r]. Ruby's `.` is [^\n], and with `\r` a line break it is
// [^\r\n] here. All patterns are sticky: anchored at lastIndex.
export const RE_MACRO_HEAD = /\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]\w*(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*/y;
const RE_CALL_END = /(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*[ \t\n\v\f\r]*\}/y;

/** Length of the match of sticky `re` at `index` in `s`, or -1. */
export function match(re: RegExp, s: string, index = 0): number {
	re.lastIndex = index;
	return re.test(s) ? re.lastIndex - index : -1;
}

/** Whether a line from {@link ScanSource.line} ends with a break (not at the end of input). */
export function endsLine(s: string): boolean {
	const c = s.charCodeAt(s.length - 1);
	return c === LF || c === CR;
}

/** Length of the break that ends a line: 2 for `\r\n`, 1 for `\n` or `\r`, 0 for none. */
export function breakLength(s: string): number {
	const c = s.charCodeAt(s.length - 1);
	if (c === CR) return 1;
	if (c !== LF) return 0;
	return s.charCodeAt(s.length - 2) === CR ? 2 : 1;
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

/** `text.indexOf(ch, from)` (or the text length), cached so a forward scan stays linear. */
class NextIndex {
	private at = -1;
	private from = 0;
	private readonly text: string;
	private readonly ch: string;

	constructor(text: string, ch: string) {
		this.text = text;
		this.ch = ch;
	}

	find(abs: number): number {
		if (abs < this.from || abs > this.at) {
			const at = this.text.indexOf(this.ch, abs);
			this.at = at < 0 ? this.text.length : at;
			this.from = abs;
		}
		return this.at;
	}
}

/** A {@link ScanSource} over a string, for tokens starting at `base`. */
export class StringSource implements ScanSource {
	base = 0;
	private readonly text: string;
	private readonly nl: NextIndex;
	private readonly cr: NextIndex;

	constructor(text: string) {
		this.text = text;
		this.nl = new NextIndex(text, '\n');
		this.cr = new NextIndex(text, '\r');
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
		const nl = this.nl.find(abs);
		const cr = this.cr.find(abs);
		const end = cr < nl ? (cr + 1 === nl ? nl + 1 : cr + 1) : nl + 1;
		return text.slice(abs, end);
	}
}

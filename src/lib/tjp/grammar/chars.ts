// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Character reads around a token for the tokenizer (lexer.ts) and the context tracker
 * (context.ts). `peek(offset)` returns the code unit at an offset from the token start, or -1
 * outside the input, as Lezer's `InputStream.peek` does.
 */
export type Peek = (offset: number) => number;

/** `\w` in Ruby: ASCII letters, digits and `_`. */
export function isWordChar(c: number): boolean {
	return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95;
}

/** Ruby's `\s`: [ \t\n\v\f\r]. */
export function isSpace(c: number): boolean {
	return c === 32 || (c >= 9 && c <= 13);
}

/** The word characters from `offset`, after skipping blanks if `skipSpace`. */
export function readWord(peek: Peek, offset: number, skipSpace = false): string {
	let i = offset;
	if (skipSpace) while (isSpace(peek(i))) i++;
	let s = '';
	for (let c = peek(i); isWordChar(c); c = peek(++i)) s += String.fromCharCode(c);
	return s;
}

/**
 * Lezer tracks look-behind of up to 25 code units for incremental reparsing, so line starts are
 * only seen through that much indentation.
 */
export const MAX_LOOKBEHIND = 24;

/**
 * Whether the token starts a line: only blanks (no `\n`) lie between it and the previous line
 * feed or the start of the input, and they fit in MAX_LOOKBEHIND. Longer indentation counts as
 * not starting a line.
 */
export function startsLine(peek: Peek): boolean {
	for (let i = 1; i <= MAX_LOOKBEHIND; i++) {
		const c = peek(-i);
		if (c === 10 || c < 0) return true;
		if (c !== 32 && c !== 9 && c !== 11 && c !== 12 && c !== 13) return false;
	}
	return false;
}

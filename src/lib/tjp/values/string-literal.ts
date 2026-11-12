// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * String literals (ProjectFileScanner.rb:100-132, 216-299).
 *
 * - `"…"` and `'…'` may span lines. The only escape is a backslash before the closing quote
 *   character (`\"` or `\'`); every other backslash is kept as it is. So a value that ends with a
 *   backslash cannot be quoted: `"a\"` would escape the closing quote.
 * - A cut-here string starts with `-8<-`, which must end its line, and ends at a line whose first
 *   non-blank text is `->8-`. The first line's indentation is removed from every line, and the
 *   value is the lines in between, each with its newline.
 * - TaskJuggler expands `${…}` macro calls inside strings and `$(NAME)` on a string's first line,
 *   so text holding them cannot be written literally (`unsafe-text`; spec 7.1 `renameTask`).
 */
import { parseWith } from './cursor';
import { hasExpansion, type StringStyle } from './lex';
import { fail, ok, type Parsed, type Result } from './result';

export type { StringStyle };

export function parseString(text: string, base = 0): Parsed<string, { style: StringStyle }> {
	let style: StringStyle = 'double';
	return parseWith(
		text,
		base,
		(c) => {
			const t = c.expect('string');
			style = t.str?.style ?? 'double';
			return t.str?.value ?? '';
		},
		() => ({ style }),
	);
}

export interface PrintStringOptions {
	/** Quote style; default `double`. */
	readonly style?: StringStyle;
	/** Indentation for the lines of a cut-here string. */
	readonly indent?: string;
}

const CUT_END_LINE = /^[ \t\n\v\f\r]*->8-/;

/** True when a value can be written as a literal in some style (no macro or env expansion). */
export function isSafeText(value: string): boolean {
	return !hasExpansion(value);
}

/**
 * Canonical text of a string value, escaping the quote character of the chosen style. Line
 * breaks (`\r\n`, a lone `\r`) are written as `\n`, which is what TaskJuggler reads back.
 */
export function printString(raw: string, opts: PrintStringOptions = {}): Result<string> {
	const value = raw.replace(/\r\n?/g, '\n');
	if (!isSafeText(value)) return fail('unsafe-text', 0, 0);
	const style = opts.style ?? 'double';
	if (style === 'cut') return printCut(value, opts.indent ?? '');
	if (value.endsWith('\\'))
		return fail('unrepresentable', 0, 0, null, { reason: 'trailing-backslash' });
	const q = style === 'double' ? '"' : "'";
	return ok(q + value.split(q).join(`\\${q}`) + q);
}

function printCut(value: string, indent: string): Result<string> {
	if (!/^[ \t]*$/.test(indent)) return fail('unrepresentable', 0, 0, null, { reason: 'indent' });
	if (value !== '' && !value.endsWith('\n')) {
		return fail('unrepresentable', 0, 0, null, { reason: 'no-final-newline' });
	}
	const lines = value === '' ? [] : value.slice(0, -1).split('\n');
	if (lines.length > 0 && /^[ \t\v\f\r]/.test(lines[0] ?? '')) {
		return fail('unrepresentable', 0, 0, null, { reason: 'leading-blank' });
	}
	if (lines.some((l) => CUT_END_LINE.test(indent + l))) {
		return fail('unrepresentable', 0, 0, null, { reason: 'end-mark' });
	}
	const body = lines.map((l) => `${indent}${l}\n`).join('');
	return ok(`-8<-\n${body}${indent}->8-`);
}

/** Prints in `style` when possible, else in the first style that can hold the value. */
export function printStringPreferring(value: string, style: StringStyle): Result<string> {
	const order: StringStyle[] = [style, 'double', 'single', 'cut'];
	let last: Result<string> = fail('unrepresentable', 0, 0);
	for (const s of order) {
		last = printString(value, { style: s });
		if (last.ok) return last;
	}
	return last;
}

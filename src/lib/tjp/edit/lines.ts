// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Line and node primitives for the edit layout rules (layout.ts, phase-1.md 7.2).
 *
 * Lines break as TaskJuggler reads them (`universal_newline`, 15.14): `\n`, `\r\n` or a lone
 * `\r`. Offsets are UTF-16 offsets into the file text, as everywhere in the document layer.
 * Comments are the grammar's skipped `LineComment` and `BlockComment` nodes.
 */
import type { SyntaxNode } from '@lezer/common';
import type { TjpFile } from '../document';
import { detectIndentUnit } from '../format';
import { bodyOf, isStatement, statementsIn } from '../tree';
import type { Span } from './types';

const texts = new WeakMap<TjpFile, string>();
const units = new WeakMap<TjpFile, string>();

/** The file's text as a string, cached per file version. */
export function fileText(file: TjpFile): string {
	let t = texts.get(file);
	if (t === undefined) {
		t = file.text.toString();
		texts.set(file, t);
	}
	return t;
}

/** The file's indent unit (7.2), cached per file version. */
export function indentUnit(file: TjpFile): string {
	let u = units.get(file);
	if (u === undefined) {
		u = detectIndentUnit(file);
		units.set(file, u);
	}
	return u;
}

// --- Lines -------------------------------------------------------------------------------------

export type LineBreak = '\n' | '\r\n' | '\r';

export const isBreak = (c: string | undefined): boolean => c === '\n' || c === '\r';
export const isBlankChar = (c: string | undefined): boolean => c === ' ' || c === '\t';

/** Only blanks and tabs. */
export const isBlank = (s: string): boolean => /^[ \t]*$/.test(s);

/** Start of the line holding `pos`. */
export function lineStart(text: string, pos: number): number {
	let i = pos;
	while (i > 0 && !isBreak(text[i - 1])) i--;
	return i;
}

/** End of the line holding `pos` (before its break). */
export function lineEnd(text: string, pos: number): number {
	let i = pos;
	while (i < text.length && !isBreak(text[i])) i++;
	return i;
}

/** Length of the line break at `end` (0 at the end of the text). */
export function breakLength(text: string, end: number): number {
	if (text[end] === '\r') return text[end + 1] === '\n' ? 2 : 1;
	return text[end] === '\n' ? 1 : 0;
}

/** The leading blanks and tabs of the line holding `pos`. */
export function lineIndent(text: string, pos: number): string {
	const s = lineStart(text, pos);
	let i = s;
	while (isBlankChar(text[i])) i++;
	return text.slice(s, i);
}

/** Whether only blanks and tabs precede `pos` on its line. */
export function startsLine(text: string, pos: number): boolean {
	return isBlank(text.slice(lineStart(text, pos), pos));
}

/** The most common line break of a text; '\n' when it has none. */
export function dominantBreak(text: string): LineBreak {
	let lf = 0;
	let crlf = 0;
	let cr = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '\n') lf++;
		else if (c === '\r') {
			if (text[i + 1] === '\n') {
				crlf++;
				i++;
			} else cr++;
		}
	}
	if (crlf > lf && crlf >= cr) return '\r\n';
	if (cr > lf && cr > crlf) return '\r';
	return '\n';
}

/** Start of the break that ends the line above the line starting at `start` (> 0). */
export function prevBreakStart(text: string, start: number): number {
	return start - (text[start - 1] === '\n' && text[start - 2] === '\r' ? 2 : 1);
}

/** The break of the line holding `pos`, else of the line above, else the text's dominant one. */
export function lineBreakNear(text: string, pos: number): LineBreak {
	const end = lineEnd(text, pos);
	const n = breakLength(text, end);
	if (n > 0) return text.slice(end, end + n) as LineBreak;
	const s = lineStart(text, pos);
	if (s > 0) return text.slice(prevBreakStart(text, s), s) as LineBreak;
	return dominantBreak(text);
}

type Quote = '"' | "'";

/**
 * The quote still open at the end of `line` when it starts inside `open` (null outside strings).
 * `\"` and `\'` are the only escapes; `#` and `//` outside strings end the line.
 */
export function quoteAfter(line: string, open: Quote | null): Quote | null {
	let q = open;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (q) {
			if (c === '\\' && line[i + 1] === q) i++;
			else if (c === q) q = null;
		} else if (c === '"' || c === "'") q = c;
		else if (c === '#' || (c === '/' && line[i + 1] === '/')) break;
	}
	return q;
}

/**
 * Statement text in the file's layout: `\n` becomes `eol`, each line after the first starts with
 * `indent`, and leading tabs become indent units, except for lines that start inside a `"` or `'`
 * string: those and the break before them stay exactly as given (they are part of the value).
 * Cut-here strings are re-indented with the rest; TaskJuggler strips their first line's
 * indentation from every line, so a uniform shift keeps the value.
 */
export function renderStatement(
	stmt: string,
	indent: string,
	unit: string,
	eol: LineBreak,
): string {
	let out = '';
	let quote: Quote | null = null;
	stmt.split('\n').forEach((line, i) => {
		if (quote) out += '\n' + line;
		else {
			let n = 0;
			while (line[n] === '\t') n++;
			out += (i === 0 ? '' : eol + indent) + unit.repeat(n) + line.slice(n);
		}
		quote = quoteAfter(line, quote);
	});
	return out;
}

// --- Nodes -------------------------------------------------------------------------------------

/** The statement node of a file with exactly this range, or null. */
export function statementNode(file: TjpFile, span: Span): SyntaxNode | null {
	for (let n: SyntaxNode | null = file.tree.resolveInner(span.from, 1); n; n = n.parent) {
		if (n.from < span.from) break;
		if (isStatement(n) && n.from === span.from && n.to === span.to) return n;
	}
	return null;
}

const COMMENTS: ReadonlySet<string> = new Set(['LineComment', 'BlockComment']);

/**
 * Where the trailing comments after `pos` on its line end, or null when other text follows.
 * Returns `pos`'s line end (or a later one, for a block comment that runs on) otherwise.
 */
export function trailingEnd(file: TjpFile, pos: number): number | null {
	const text = fileText(file);
	let i = pos;
	for (;;) {
		while (isBlankChar(text[i])) i++;
		if (i >= text.length || isBreak(text[i])) return i;
		const leaf = file.tree.resolveInner(i, 1);
		if (!COMMENTS.has(leaf.name) || leaf.from !== i) return null;
		i = leaf.to;
	}
}

/** Start of the comment lines attached directly above a statement (no blank line), else its line. */
export function attachedStart(file: TjpFile, stmt: Span): number {
	const text = fileText(file);
	let start = lineStart(text, stmt.from);
	if (!startsLine(text, stmt.from)) return stmt.from;
	while (start > 0) {
		const prevEnd = prevBreakStart(text, start);
		const prevStart = lineStart(text, prevEnd);
		let last = prevEnd;
		while (last > prevStart && isBlankChar(text[last - 1])) last--;
		if (last === prevStart) break;
		const leaf = file.tree.resolveInner(last - 1, 1);
		if (!COMMENTS.has(leaf.name) || leaf.to !== last || !startsLine(text, leaf.from)) break;
		start = lineStart(text, leaf.from);
	}
	return start;
}

/** Whether a blank line separates a statement (with its attached comments) from the text above. */
export function blankLineBefore(file: TjpFile, stmt: Span): boolean {
	const text = fileText(file);
	const s = attachedStart(file, stmt);
	if (s === 0 || !startsLine(text, stmt.from)) return false;
	const prevEnd = prevBreakStart(text, s);
	return isBlank(text.slice(lineStart(text, prevEnd), prevEnd));
}

/** The indentation of statements in `body`: its first own-line statement's, else header + unit. */
export function bodyIndent(file: TjpFile, owner: SyntaxNode): string {
	const text = fileText(file);
	const body = bodyOf(owner);
	if (body) {
		for (const s of statementsIn(body))
			if (startsLine(text, s.from)) return lineIndent(text, s.from);
	}
	return lineIndent(text, owner.from) + indentUnit(file);
}

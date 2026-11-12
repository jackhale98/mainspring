// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Line helpers for diagnostics (phase-1.md 6.6).
 *
 * - Engine lines: TaskJuggler reads files with `universal_newline` (15.14), so `\r\n`, a lone
 *   `\r` and `\n` each end a line. Documents split on `\n` only (document.ts), so an engine line
 *   number is resolved here against the text itself, not with `Text.line`.
 * - Positions: `line` and `column` of a diagnostic use the same line rule (1-based, UTF-16
 *   columns), so a diagnostic's line is the engine's line when no refinement moved it. The
 *   shared helper planned in src/lib/tjp/lines.ts can replace `lineTable` here alone.
 * - Leaves: the tokens of a range, with comments and the BOM marked as trivia.
 */
import type { Text } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';

export interface Span {
	from: number;
	to: number;
}

/** One engine line: its content without the line break, and its 1-based number. */
export interface LineSpan extends Span {
	number: number;
}

interface LineTable {
	starts: number[];
	ends: number[];
}

const tables = new WeakMap<Text, LineTable>();
const strings = new WeakMap<Text, string>();

/** The text as a string, cached per `Text`. */
export function textString(doc: Text): string {
	let s = strings.get(doc);
	if (s === undefined) {
		s = doc.toString();
		strings.set(doc, s);
	}
	return s;
}

function lineTable(doc: Text): LineTable {
	let t = tables.get(doc);
	if (t) return t;
	const s = textString(doc);
	const starts = [0];
	const ends: number[] = [];
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c === 10 || c === 13) {
			ends.push(i);
			if (c === 13 && s.charCodeAt(i + 1) === 10) i++;
			starts.push(i + 1);
		}
	}
	ends.push(s.length);
	t = { starts, ends };
	tables.set(doc, t);
	return t;
}

/** Number of engine lines (a final line break starts an empty last line). */
export function engineLineCount(doc: Text): number {
	return lineTable(doc).starts.length;
}

/** Engine line `line`, clamped to the first and last line. */
export function engineLine(doc: Text, line: number): LineSpan {
	const t = lineTable(doc);
	const n = Math.min(Math.max(1, Math.floor(line)), t.starts.length);
	return { from: t.starts[n - 1] ?? 0, to: t.ends[n - 1] ?? 0, number: n };
}

/** The engine line that holds offset `pos`. */
export function engineLineAt(doc: Text, pos: number): number {
	const { starts } = lineTable(doc);
	let lo = 0;
	let hi = starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if ((starts[mid] ?? 0) <= pos) lo = mid;
		else hi = mid - 1;
	}
	return lo + 1;
}

/**
 * Line and UTF-16 column (both 1-based) of `pos`, with lines counted as TaskJuggler counts them
 * (the same as CodeMirror's gutter unless the file has a lone `\r`).
 */
export function lineColumn(doc: Text, pos: number): { line: number; column: number } {
	const p = Math.min(Math.max(0, pos), doc.length);
	const line = engineLineAt(doc, p);
	return { line, column: p - engineLine(doc, line).from + 1 };
}

/** Leaves that are not content: comments and the BOM. */
export const TRIVIA: ReadonlySet<string> = new Set(['LineComment', 'BlockComment', 'Bom']);

export interface Leaf {
	readonly node: SyntaxNode;
	readonly name: string;
	readonly from: number;
	readonly to: number;
}

/**
 * Leaf nodes that overlap `[from, to)`, in document order (comments included: they are named
 * skip tokens), plus zero-width error nodes inside the range.
 */
export function leavesIn(tree: Tree, from: number, to: number): Leaf[] {
	const out: Leaf[] = [];
	tree.iterate({
		from,
		to,
		enter(n) {
			if (n.to < from || n.from > to) return false;
			const node = n.node;
			if (node.firstChild) return undefined;
			const empty = n.from === n.to;
			if (empty ? n.from >= from && n.from <= to : n.to > from && n.from < to) {
				out.push({ node, name: n.name, from: n.from, to: n.to });
			}
			return undefined;
		},
	});
	return out;
}

const SPACE = /[ \t\v\f\r\n]/;

/**
 * The content of `line`: from its first to its last non-blank character, leaving out comments
 * (a trailing `# …` or `/* … *\/`, or a line that holds only a comment). Null when the line has
 * no content.
 */
export function contentSpan(tree: Tree, text: string, line: Span): Span | null {
	let from = -1;
	let to = -1;
	for (const leaf of leavesIn(tree, line.from, line.to)) {
		if (TRIVIA.has(leaf.name) || leaf.from === leaf.to) continue;
		const a = Math.max(leaf.from, line.from);
		const b = Math.min(leaf.to, line.to);
		if (b <= a) continue;
		if (from < 0) from = a;
		to = b;
	}
	if (from < 0) return null;
	while (from < to && SPACE.test(text.charAt(from))) from++;
	while (to > from && SPACE.test(text.charAt(to - 1))) to--;
	return to > from ? { from, to } : null;
}

/** The nearest engine line at or before `line` that has content, as its content span. */
export function contentAtOrBefore(
	tree: Tree,
	doc: Text,
	line: number,
): (Span & { line: number }) | null {
	for (let n = line; n >= 1; n--) {
		const span = contentSpan(tree, textString(doc), engineLine(doc, n));
		if (span) return { ...span, line: n };
	}
	return null;
}

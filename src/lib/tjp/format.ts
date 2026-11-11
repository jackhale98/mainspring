// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Format on demand (phase-1.md 7.3; ADR-0003 #7: indentation only). `formatFile` returns the
 * CodeMirror changes that re-indent a file; nothing but the blanks and tabs at the start and end
 * of lines ever changes.
 *
 * Each line is classified (`analyzeLines`):
 * - `absolute`: its first token starts a statement, or is a comment between statements, or is a
 *   body's `{` or `}`. Indentation = depth × unit, where depth counts the enclosing `Body` nodes
 *   (so the `{ }` of `%{ … }` date expressions do not count); a body's own braces get one level
 *   less.
 * - `continuation`: its first token lies inside a statement begun on an earlier line. It keeps its
 *   offset from that statement's first line: the old indentation of that line is replaced by its
 *   new one. When the old indentations are not prefixes of each other, the column difference
 *   (tabs to multiples of TAB_WIDTH) is written as spaces. Lines inside a body that opens in the
 *   middle of a continuation line (an opaque column spec `columns a,\n  b { width 9\n  title "B" }`)
 *   are continuations of the statement that owns the body too, so aligned item bodies keep
 *   their layout.
 * - `blank`: only blanks; they are removed.
 * - `kept`: the indentation is left exactly as written. These are lines that start inside a
 *   token (the inner lines of strings, cut-here strings, block comments, macro bodies and macro
 *   calls), lines in the macro-related text-only ranges of 5.4 (FROZEN_REASONS: a multi-line
 *   macro body, macro call statement or block whose id is a macro), lines that start with the
 *   BOM, and lines whose indentation holds other whitespace than blanks and tabs (`\v`, `\f`,
 *   or a `\r` that does not end the line).
 *
 * Trailing blanks and tabs are removed, before a final `\r` if the line has one, except when the
 * line ends inside a string, a macro body, a macro call or a frozen range (a multi-line macro
 * body only closes on a `]` right before `\n`, scanner.ts; a cut-here mark may be followed by
 * blanks). Line endings, blank lines, the final newline, spacing between tokens and comment
 * inner lines' indentation never change.
 *
 * The indent unit (7.2) is the most common step between a block header's indentation and its
 * body's first statement: a tab or N spaces (first seen wins a tie; two spaces without bodies).
 * Formatting is idempotent: the steps it writes are all that unit, so the unit is still the most
 * common one afterwards.
 *
 * Files with syntax errors are refused. As a safety net the result is reparsed, and refused
 * (`unstable-parse`) unless it has the same tree shape (the tokenizer sees line starts through
 * at most 24 code units of indentation, grammar/chars.ts).
 *
 * The edit API's `formatFile(ws, file): EditResult` (6.5, T10) wraps this: its targets are the
 * changed ranges, and `unstable-parse` has no 6.5 refusal reason yet.
 */
import type { Line, Text } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { changeSetOf, updateFile, type TjpFile } from './document';
import { textOnlyOf, type TextOnlyReason } from './text-only';
import { isStatement, syntaxIssues, type SourceRange } from './tree';

/** One CodeMirror ChangeSpec in the file's coordinates. */
export interface FormatChange {
	readonly from: number;
	readonly to: number;
	readonly insert: string;
}

export interface FormatOptions {
	/** Format only the lines that touch [from, to] (default: the whole file). */
	readonly from?: number;
	readonly to?: number;
	/** The indent unit to use ('\t' or spaces) instead of the detected one. */
	readonly unit?: string;
}

export type FormatRefusalReason = 'syntax-error' | 'unstable-parse';

export type FormatResult =
	| { readonly status: 'format'; readonly changes: readonly FormatChange[]; readonly unit: string }
	| {
			readonly status: 'refused';
			readonly reason: FormatRefusalReason;
			readonly at: readonly SourceRange[];
	  };

export type LineKind = 'absolute' | 'continuation' | 'blank' | 'kept';

export interface LineInfo {
	readonly kind: LineKind;
	/** Indentation levels of an `absolute` line, else 0. */
	readonly depth: number;
	/** 1-based number of the first line of a `continuation` line's statement, else 0. */
	readonly anchor: number;
	/** Whether blanks and tabs at the end of this line are removed (also when it has none). */
	readonly stripTrailing: boolean;
}

/** Text-only reasons (5.4) whose ranges keep their layout: they belong to macro expansion. */
export const FROZEN_REASONS: ReadonlySet<TextOnlyReason> = new Set<TextOnlyReason>([
	'macro-body',
	'macro-call',
	'env-var',
	'macro-id',
	'expanded-only',
]);

/** Tokens whose text at the end of a line keeps its trailing blanks. */
const KEEP_TRAILING: ReadonlySet<string> = new Set([
	'String',
	'TemplateString',
	'MacroBody',
	'MacroCall',
	'MacroWord',
	'EnvRef',
]);

export const DEFAULT_UNIT = '  ';
export const TAB_WIDTH = 8;

/** The leading blanks and tabs of a line. */
export function indentOf(line: string): string {
	let n = 0;
	while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++;
	return line.slice(0, n);
}

/** Where a line's content ends: before a final `\r`. */
function contentEnd(line: string): number {
	return line.endsWith('\r') ? line.length - 1 : line.length;
}

interface Span {
	from: number;
	to: number;
}

/** The FROZEN_REASONS ranges of a file, merged where they overlap, sorted. */
function frozenSpans(file: TjpFile): Span[] {
	const out: Span[] = [];
	for (const t of textOnlyOf(file)) {
		if (!FROZEN_REASONS.has(t.reason)) continue;
		const last = out[out.length - 1];
		if (last && t.at.from < last.to) last.to = Math.max(last.to, t.at.to);
		else out.push({ from: t.at.from, to: t.at.to });
	}
	return out;
}

/** The span that contains `pos` (from <= pos < to), or null. */
function spanAt(spans: readonly Span[], pos: number): Span | null {
	let lo = 0;
	let hi = spans.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		const s = spans[mid];
		if (!s || s.to <= pos) lo = mid + 1;
		else hi = mid;
	}
	const s = spans[lo];
	return s && s.from <= pos ? s : null;
}

/** The leaf token that covers `pos`, or null in whitespace. */
function leafAt(tree: Tree, pos: number): SyntaxNode | null {
	const n = tree.resolveInner(pos, 1);
	return !n.firstChild && !n.type.isTop && n.from <= pos && pos < n.to ? n : null;
}

function bodyDepth(node: SyntaxNode): number {
	let d = 0;
	for (let n = node.parent; n; n = n.parent) if (n.name === 'Body') d++;
	return d;
}

/**
 * For a line inside a body that opens in the middle of a continuation line (`columns a,\n  b {`),
 * the first line of the statement that owns the innermost such body; else 0.
 */
function continuedAnchor(leaf: SyntaxNode, doc: Text): number {
	for (let b = leaf.parent; b; b = b.parent) {
		if (b.name !== 'Body') continue;
		let owner = b.parent;
		while (owner && !isStatement(owner)) owner = owner.parent;
		if (!owner) continue;
		const open = doc.lineAt(b.from);
		const head = doc.lineAt(owner.from).number;
		if (open.number !== head && b.from !== open.from + indentOf(open.text).length) return head;
	}
	return 0;
}

const KEPT: LineInfo = { kind: 'kept', depth: 0, anchor: 0, stripTrailing: false };

function classify(tree: Tree, doc: Text, line: Line, spans: readonly Span[]): LineInfo {
	const text = line.text;
	const indent = indentOf(text);
	const end = contentEnd(text);
	const p = line.from + indent.length;
	const tail = trimEnd(text, end);
	const q = line.from + tail;
	const stripTrailing =
		spanAt(spans, q) === null && !KEEP_TRAILING.has(leafAt(tree, q)?.name ?? '');
	const inside = leafAt(tree, line.from);
	if (inside && inside.from < line.from) return { ...KEPT, stripTrailing };
	const frozen = spanAt(spans, line.from);
	if (frozen && frozen.from < line.from) return { ...KEPT, stripTrailing };
	if (indent.length === end) return { kind: 'blank', depth: 0, anchor: 0, stripTrailing: true };
	const leaf = leafAt(tree, p);
	if (!leaf || leaf.from !== p || leaf.name === 'Bom') return { ...KEPT, stripTrailing };
	const startsFrozen = spanAt(spans, p);
	if (startsFrozen && startsFrozen.to > line.to) return { ...KEPT, stripTrailing };
	const continued = continuedAnchor(leaf, doc);
	if (continued > 0) return { kind: 'continuation', depth: 0, anchor: continued, stripTrailing };
	const depth = bodyDepth(leaf);
	if ((leaf.name === 'OpenBrace' || leaf.name === 'CloseBrace') && leaf.parent?.name === 'Body') {
		return { kind: 'absolute', depth: depth - 1, anchor: 0, stripTrailing };
	}
	let n = leaf.parent;
	while (n && !n.type.isTop && n.name !== 'Body' && !isStatement(n)) n = n.parent;
	if (!n || n.type.isTop || n.name === 'Body' || n.from === p) {
		return { kind: 'absolute', depth, anchor: 0, stripTrailing };
	}
	return { kind: 'continuation', depth: 0, anchor: doc.lineAt(n.from).number, stripTrailing };
}

/** Where the trailing blanks and tabs before `end` start. */
function trimEnd(text: string, end: number): number {
	let i = end;
	while (i > 0 && (text[i - 1] === ' ' || text[i - 1] === '\t')) i--;
	return i;
}

/** How each line of an error-free file is formatted; index 0 is line 1. */
export function analyzeLines(file: TjpFile): LineInfo[] {
	const spans = frozenSpans(file);
	const out: LineInfo[] = [];
	for (let i = 1; i <= file.text.lines; i++) {
		out.push(classify(file.tree, file.text, file.text.line(i), spans));
	}
	return out;
}

/** The file's indent unit (7.2): '\t' or N spaces, DEFAULT_UNIT when no body shows one. */
export function detectIndentUnit(file: TjpFile): string {
	const doc = file.text;
	const counts = new Map<string, number>();
	file.tree.iterate({
		enter(ref) {
			if (ref.name !== 'Body') return;
			const body = ref.node;
			let first = body.firstChild;
			while (first && !isStatement(first)) first = first.nextSibling;
			const owner = body.parent;
			if (!first || !owner) return;
			const line = doc.lineAt(first.from);
			const head = doc.lineAt(owner.from);
			const inner = indentOf(line.text);
			if (line.number === head.number || first.from !== line.from + inner.length) return;
			const outer = indentOf(head.text);
			if (!inner.startsWith(outer)) return;
			const step = inner.slice(outer.length);
			if (step === '\t' || /^ +$/.test(step)) counts.set(step, (counts.get(step) ?? 0) + 1);
		},
	});
	let best = DEFAULT_UNIT;
	let most = 0;
	for (const [step, n] of counts) {
		if (n > most) {
			best = step;
			most = n;
		}
	}
	return best;
}

function columns(ws: string): number {
	let c = 0;
	for (const ch of ws) c = ch === '\t' ? (Math.floor(c / TAB_WIDTH) + 1) * TAB_WIDTH : c + 1;
	return c;
}

/** The new indentation of every line (index 0 is line 1). */
export function newIndents(doc: Text, infos: readonly LineInfo[], unit: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < infos.length; i++) {
		const info = infos[i];
		const old = indentOf(doc.line(i + 1).text);
		if (!info || info.kind === 'kept') out.push(old);
		else if (info.kind === 'blank') out.push('');
		else if (info.kind === 'absolute') out.push(unit.repeat(Math.max(0, info.depth)));
		else {
			const anchorOld = indentOf(doc.line(info.anchor).text);
			const anchorNew = out[info.anchor - 1] ?? anchorOld;
			out.push(
				old.startsWith(anchorOld)
					? anchorNew + old.slice(anchorOld.length)
					: anchorNew + ' '.repeat(Math.max(0, columns(old) - columns(anchorOld))),
			);
		}
	}
	return out;
}

/** The smallest change that turns `old` at `from` into `next`, or null when they are equal. */
function minimalChange(from: number, old: string, next: string): FormatChange | null {
	if (old === next) return null;
	let a = 0;
	while (a < old.length && a < next.length && old[a] === next[a]) a++;
	let b = 0;
	while (
		b < old.length - a &&
		b < next.length - a &&
		old[old.length - 1 - b] === next[next.length - 1 - b]
	) {
		b++;
	}
	return { from: from + a, to: from + old.length - b, insert: next.slice(a, next.length - b) };
}

/** The changes that format `file` (7.3), or a refusal. */
export function formatFile(file: TjpFile, opts: FormatOptions = {}): FormatResult {
	const issues = syntaxIssues(file.tree, file.text);
	if (issues.length > 0) {
		const at = issues.map((i) => ({ file: file.path, from: i.from, to: i.to }));
		return { status: 'refused', reason: 'syntax-error', at };
	}
	const doc = file.text;
	const unit = opts.unit ?? detectIndentUnit(file);
	const infos = analyzeLines(file);
	const indents = newIndents(doc, infos, unit);
	const from = opts.from ?? 0;
	const to = opts.to ?? doc.length;
	const changes: FormatChange[] = [];
	for (let i = 1; i <= doc.lines; i++) {
		const line = doc.line(i);
		if (line.to < from || line.from > to) continue;
		const info = infos[i - 1];
		const old = indentOf(line.text);
		const lead = minimalChange(line.from, old, indents[i - 1] ?? old);
		if (lead) changes.push(lead);
		const end = contentEnd(line.text);
		const start = Math.max(trimEnd(line.text, end), lead ? old.length : 0);
		if (info?.stripTrailing && start < end) {
			changes.push({ from: line.from + start, to: line.from + end, insert: '' });
		}
	}
	if (changes.length === 0) return { status: 'format', changes, unit };
	const after = updateFile(file, changeSetOf(changes, doc.length));
	if (syntaxIssues(after.tree, after.text).length > 0 || !sameShape(file.tree, after.tree)) {
		return {
			status: 'refused',
			reason: 'unstable-parse',
			at: [{ file: file.path, from: 0, to: doc.length }],
		};
	}
	return { status: 'format', changes, unit };
}

/** Whether two trees have the same nodes in the same order (positions aside). */
export function sameShape(a: Tree, b: Tree): boolean {
	const ca = a.cursor();
	const cb = b.cursor();
	for (;;) {
		if (ca.type !== cb.type) return false;
		const na = ca.next();
		const nb = cb.next();
		if (na !== nb) return false;
		if (!na) return true;
	}
}

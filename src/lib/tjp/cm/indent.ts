// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Indentation for new and re-indented lines, by the rules of format on demand (phase-1.md 7.3,
 * format.ts `classify`), so that typing and formatting agree:
 *
 * - A body's own `{` or `}` at the start of a line gets one level less than the body's inside.
 * - A line whose first token continues a statement begun on an earlier line (inside a header or
 *   a value list, or after a trailing comma) gets that statement's first-line indentation plus
 *   one unit. Format keeps a continuation's offset from its first line, so this survives it.
 * - Any other line gets depth × unit, where depth counts the enclosing `Body` nodes.
 * - Inside a string, comment, macro body or unterminated token the service has no opinion
 *   (null), and CodeMirror keeps the previous line's indentation, as format leaves those lines.
 * - Enter inside a quoted string (`"…"`, `'…'`, also unterminated) is `enterInString`: a bare
 *   line break, because whitespace there is part of the value and insertNewlineAndIndent would
 *   add indentation and delete the blanks after the cursor. Cut-here strings (`-8<-` … `->8-`)
 *   are not quoted: TaskJuggler strips their common indentation, so indenting is right there.
 *
 * The indent unit is the file's (7.2): the most common step between a block header's line and
 * its body's first line, a tab or N spaces, two spaces by default. `textIndentUnit` reads it from
 * the text alone, so it is known before the parse finishes; a corpus test checks it against
 * format.ts `detectIndentUnit`. It is fixed for the life of the state, except that the format
 * command sets it to the unit it formatted with (`setIndentUnit`).
 */
import { insertNewline } from '@codemirror/commands';
import {
	StateEffect,
	StateField,
	type EditorState,
	type Extension,
	type StateCommand,
	type Text,
} from '@codemirror/state';
import { indentService, indentUnit, type IndentContext } from '@codemirror/language';
import type { SyntaxNode, Tree } from '@lezer/common';
import { DEFAULT_UNIT, indentOf } from '../format';
import { isStatement } from '../tree';
import { bodiesAt, inOpaqueToken, leafAt, treeAt } from './context';

/** Whether a line, without a `#` comment, ends with `{`. Naive about strings, as a heuristic. */
function opensBody(line: string): boolean {
	const hash = line.indexOf('#');
	return (hash >= 0 ? line.slice(0, hash) : line).trimEnd().endsWith('{');
}

function isCommentLine(content: string): boolean {
	return content.startsWith('#') || content.startsWith('//') || content.startsWith('/*');
}

/** The file's indent unit from its text (module comment); DEFAULT_UNIT when no body shows one. */
export function textIndentUnit(doc: Text): string {
	const counts = new Map<string, number>();
	for (let i = 1; i < doc.lines; i++) {
		const head = doc.line(i).text;
		if (!opensBody(head)) continue;
		for (let j = i + 1; j <= doc.lines; j++) {
			const text = doc.line(j).text;
			const inner = indentOf(text);
			const content = text.slice(inner.length).trim();
			if (content === '' || isCommentLine(content)) continue;
			const outer = indentOf(head);
			if (content.startsWith('}') || !inner.startsWith(outer)) break;
			const step = inner.slice(outer.length);
			if (step === '\t' || /^ +$/.test(step)) counts.set(step, (counts.get(step) ?? 0) + 1);
			break;
		}
	}
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

/** Sets the state's indent unit (the format command, after formatting). */
export const setIndentUnit = StateEffect.define<string>();

export const indentUnitField = StateField.define<string>({
	create: (state) => textIndentUnit(state.doc),
	update(value, tr) {
		let next = value;
		for (const e of tr.effects) if (e.is(setIndentUnit)) next = e.value;
		return next;
	},
	provide: (f) => indentUnit.from(f),
});

function columnsOf(ws: string, tabSize: number): number {
	let c = 0;
	for (const ch of ws) c = ch === '\t' ? c + tabSize - (c % tabSize) : c + 1;
	return c;
}

/**
 * The statement that `pos` continues: the innermost statement around it that starts before it,
 * when no body between them starts before it either; null at body level.
 */
function statementAround(tree: Tree, pos: number): SyntaxNode | null {
	for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
		if (n.name === 'Body' && n.from < pos) return null;
		if (isStatement(n) && n.from < pos && pos <= n.to) return n;
	}
	return null;
}

const MAX_BACK = 4096;

/** The last code character before `pos`, skipping whitespace and line comments; -1 if none. */
export function lastCodeBefore(state: EditorState, tree: Tree, pos: number): number {
	let i = pos;
	for (let steps = 0; i > 0 && steps < MAX_BACK; steps++) {
		const ch = state.sliceDoc(i - 1, i);
		if (/\s/.test(ch)) {
			i--;
			continue;
		}
		const leaf = leafAt(tree, i - 1, 1);
		if (leaf && leaf.name === 'LineComment' && leaf.from < i) {
			i = leaf.from;
			continue;
		}
		return i - 1;
	}
	return -1;
}

/** The indentation (in columns) of a line starting at `pos`, or null (module comment). */
export function tjpIndentation(cx: IndentContext, pos: number): number | null {
	const state = cx.state;
	const tree = treeAt(state, pos);
	if (inOpaqueToken(tree, pos)) return null;
	const after = cx.textAfterPos(pos);
	const p = pos + indentOf(after).length;
	const unit = cx.unit;
	// With a simulated double break (Enter between `{` and `}`) the line is empty, even though
	// the `}` follows `pos` in the document.
	const leaf = after.trim() === '' ? null : leafAt(tree, p, 1);
	const brace =
		leaf !== null &&
		leaf.from === p &&
		(leaf.name === 'OpenBrace' || leaf.name === 'CloseBrace') &&
		leaf.parent?.name === 'Body';
	if (!brace) {
		const last = lastCodeBefore(state, tree, pos);
		const comma = last >= 0 && state.sliceDoc(last, last + 1) === ',';
		const stmt = comma ? statementAround(tree, last) : statementAround(tree, p);
		if (stmt && stmt.from < pos) {
			return columnsOf(indentOf(state.doc.lineAt(stmt.from).text), state.tabSize) + unit;
		}
	}
	let depth = bodiesAt(tree, p).length;
	if (brace && leaf?.name === 'CloseBrace') depth--;
	return Math.max(0, depth) * unit;
}

/** The indentation service and the file's indent unit. */
export function tjpIndent(): Extension {
	return [indentUnitField, indentService.of(tjpIndentation)];
}

const QUOTED: ReadonlySet<string> = new Set(['String', 'TemplateString', 'ScanError']);

/** Whether `pos` is strictly inside a quoted string token (module comment). */
export function inQuotedString(state: EditorState, pos: number): boolean {
	const tree = treeAt(state, pos);
	for (const side of [-1, 1] as const) {
		const leaf = leafAt(tree, pos, side);
		if (!leaf || !QUOTED.has(leaf.name) || leaf.from >= pos) continue;
		const open = state.sliceDoc(leaf.from, leaf.from + 1);
		if (open !== '"' && open !== "'") continue;
		if (pos < leaf.to || leaf.name === 'ScanError') return true;
	}
	return false;
}

/** Enter inside a quoted string: a bare line break; false elsewhere (module comment). */
export const enterInString: StateCommand = (target) => {
	const { state } = target;
	if (!state.selection.ranges.some((r) => inQuotedString(state, r.from))) return false;
	return insertNewline(target);
};

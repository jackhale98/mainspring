// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Helpers over TJP syntax trees (phase-1.md 5.5, 6.1) shared by the document layer, the index
 * (T8) and the edit API (T10): the lossless printer, syntax issues, and statement navigation.
 *
 * Tree shape (grammar/parser.ts): `File` and every `Body` hold statements, whose node names end
 * in `Statement`. A statement starts with an optional `ScenarioPrefix`, then its head.
 */
import type { Text } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import type { WorkspacePath } from '../../engine/protocol';

/** A range in one workspace file, in UTF-16 offsets. */
export interface SourceRange {
	file: WorkspacePath;
	from: number;
	to: number;
}

/** A gap between leaves holds something other than whitespace, so the tree misses input. */
export class CoverageError extends Error {
	constructor(
		readonly from: number,
		readonly to: number,
		readonly gap: string,
	) {
		super(`non-whitespace gap at ${from}-${to}: ${JSON.stringify(gap)}`);
		this.name = 'CoverageError';
	}
}

/** Ruby's `\s`: ASCII whitespace only (spec 5.1). */
const WHITESPACE = /^[ \t\n\v\f\r]*$/;

/**
 * Leaf tokens plus the whitespace gaps between them, in order (spec 5.5). Throws CoverageError
 * on a non-whitespace gap. For any tree the parser gives, the result equals `text`.
 */
export function printTree(tree: Tree, text: string): string {
	const parts: string[] = [];
	let pos = 0;
	const gap = (to: number): void => {
		const g = text.slice(pos, to);
		if (!WHITESPACE.test(g)) throw new CoverageError(pos, to, g);
		parts.push(g);
	};
	const cursor = tree.cursor();
	for (;;) {
		if (!cursor.firstChild()) {
			if (cursor.type.isTop) break;
			if (cursor.from < pos) throw new CoverageError(cursor.from, pos, 'overlapping leaf');
			if (cursor.to > cursor.from || !cursor.type.isError) {
				gap(cursor.from);
				parts.push(text.slice(cursor.from, cursor.to));
				pos = cursor.to;
			}
			let done = false;
			while (!cursor.nextSibling()) {
				if (!cursor.parent()) {
					done = true;
					break;
				}
			}
			if (done) break;
		}
	}
	gap(text.length);
	return parts.join('');
}

export interface SyntaxIssue {
	from: number;
	to: number;
	/** 1-based line of `from`. */
	line: number;
}

/** The error nodes of a tree, outermost only, in document order. */
export function syntaxIssues(tree: Tree, text: Text): SyntaxIssue[] {
	const out: SyntaxIssue[] = [];
	tree.iterate({
		enter(n) {
			if (!n.type.isError) return;
			out.push({ from: n.from, to: n.to, line: text.lineAt(n.from).number });
			return false;
		},
	});
	return out;
}

/** True for statement nodes (`TaskStatement`, `OpaqueStatement`, …). */
export function isStatement(node: { readonly name: string }): boolean {
	return node.name.endsWith('Statement');
}

/** The statements directly in `parent` (the `File` node or a `Body`), in order. */
export function statementsIn(parent: SyntaxNode): SyntaxNode[] {
	const out: SyntaxNode[] = [];
	for (let c = parent.firstChild; c; c = c.nextSibling) if (isStatement(c)) out.push(c);
	return out;
}

/** A statement's head: its first child after an optional scenario prefix. */
export function statementHead(stmt: SyntaxNode): SyntaxNode | null {
	let c = stmt.firstChild;
	if (c?.name === 'ScenarioPrefix') c = c.nextSibling;
	return c;
}

/** The keyword as written that leads a statement, or null for other heads (macro calls, …). */
export function statementKeyword(stmt: SyntaxNode, text: string): string | null {
	const h = statementHead(stmt);
	return h?.name === 'Keyword' ? text.slice(h.from, h.to) : null;
}

/** The statement's own `Body`, if it has one (not the bodies of its items). */
export function bodyOf(stmt: SyntaxNode): SyntaxNode | null {
	return stmt.getChild('Body');
}

/** The innermost statement that contains `node` (itself included), or null at the top. */
export function enclosingStatement(node: SyntaxNode): SyntaxNode | null {
	for (let n: SyntaxNode | null = node; n; n = n.parent) if (isStatement(n)) return n;
	return null;
}

/** The innermost statement around `pos` (`side` as in `Tree.resolveInner`). */
export function statementAt(tree: Tree, pos: number, side: -1 | 0 | 1 = 0): SyntaxNode | null {
	return enclosingStatement(tree.resolveInner(pos, side));
}

/** The text a node covers. */
export function nodeText(
	node: { readonly from: number; readonly to: number },
	text: string,
): string {
	return text.slice(node.from, node.to);
}

/**
 * Visits the leaf nodes of `node` that belong to it and not to a nested statement (a statement
 * inside one of its bodies or item bodies). Returns early when `f` returns true.
 */
export function someOwnLeaf(node: SyntaxNode, f: (leaf: SyntaxNode) => boolean): boolean {
	for (let c = node.firstChild; c; c = c.nextSibling) {
		if (isStatement(c)) continue;
		if (c.firstChild ? someOwnLeaf(c, f) : f(c)) return true;
	}
	return false;
}

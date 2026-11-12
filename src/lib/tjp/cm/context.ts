// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where a position sits in TJP terms (phase-1.md 6.7): the keyword context (`contextAt`), the
 * keyword under a position, and whether a position is inside a token that completion and
 * indentation must leave alone.
 *
 * `contextAt` replays, over the finished tree, what the grammar's context tracker
 * (grammar/context.ts) did while parsing: starting from the file's top context, each enclosing
 * `Body` opens the context of the statement that owns it (`task` → 'task', `supplement task` →
 * 'supplement.task', the item bodies of `depends a { … }` → 'depends'). A body whose owner is not
 * a known keyword has no context (null), where no word is a keyword.
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { headBodyContext, resolveHeadKeyword } from '../grammar/keyword-extras';
import {
	isContext,
	resolveKeyword,
	topContextId,
	type ContextId,
	type KeywordEntry,
	type TopContextName,
} from '../syntax/keywords';
import { enclosingStatement, statementHead } from '../tree';

/** How long a query may wait for the editor's parser to reach a position. */
export const PARSE_TIMEOUT_MS = 25;

/**
 * The editor's tree, parsed at least up to `pos` when that takes under PARSE_TIMEOUT_MS
 * (CodeMirror parses the first 3,000 characters at once and the rest in the background).
 */
export function treeAt(state: EditorState, pos: number): Tree {
	return ensureSyntaxTree(state, pos, PARSE_TIMEOUT_MS) ?? syntaxTree(state);
}

/** Tokens whose inside is not TJP structure: strings, comments, macro bodies, unclosed text. */
const OPAQUE_TOKENS: ReadonlySet<string> = new Set([
	'String',
	'TemplateString',
	'LineComment',
	'BlockComment',
	'MacroBody',
	'MacroCall',
	'EnvRef',
	'ScanError',
]);

/** Whether `body` (a `Body` node) has a real closing brace. */
function closed(body: SyntaxNode): boolean {
	const last = body.lastChild;
	return !!last && last.name === 'CloseBrace' && last.to > last.from;
}

/** Whether `pos` is inside `body`: after its `{` and before its `}` (or it is unclosed). */
export function insideBody(body: SyntaxNode, pos: number): boolean {
	return body.from < pos && (pos < body.to || (pos === body.to && !closed(body)));
}

/** The `Body` nodes that contain `pos`, outermost first. */
export function bodiesAt(tree: Tree, pos: number): SyntaxNode[] {
	const out: SyntaxNode[] = [];
	for (let n: SyntaxNode | null = tree.resolveInner(pos, -1); n; n = n.parent) {
		if (n.name === 'Body' && insideBody(n, pos)) out.push(n);
	}
	// resolveInner(pos, -1) may stop in a node that ends at pos; bodies that start there are
	// not entered, and bodies around it are its ancestors, so the list is complete.
	return out.reverse();
}

/** The context the body `body` opens, given the context its owner statement is in. */
function openedBy(
	body: SyntaxNode,
	ctx: ContextId,
	text: (n: SyntaxNode) => string,
): ContextId | null {
	const owner = enclosingStatement(body.parent ?? body);
	if (!owner) return null;
	const head = statementHead(owner);
	if (!head || head.name !== 'Keyword') return null;
	const entry = resolveHeadKeyword(text(head), ctx);
	if (!entry) return null;
	const kind = owner.getChild('SupplementKind');
	if (kind) {
		// As grammar/context.ts subjectContext.
		const subject = text(kind);
		return headBodyContext(entry, subject) ?? (isContext(subject) ? subject : null);
	}
	return headBodyContext(entry);
}

/**
 * The keyword context at `pos` in a tree parsed with top context `top` (spec 6.7), or null in
 * a body whose context is unknown (an opaque or unknown statement's body).
 */
export function contextAt(
	tree: Tree,
	pos: number,
	top: TopContextName,
	text: (from: number, to: number) => string,
): ContextId | null {
	let ctx: ContextId = topContextId(top);
	const slice = (n: SyntaxNode): string => text(n.from, n.to);
	for (const body of bodiesAt(tree, pos)) {
		const next = openedBy(body, ctx, slice);
		if (next === null) return null;
		ctx = next;
	}
	return ctx;
}

/** The leaf token around `pos` (`from < pos < to`, or starting at pos with side 1), or null. */
export function leafAt(tree: Tree, pos: number, side: -1 | 1): SyntaxNode | null {
	const n = tree.resolveInner(pos, side);
	if (n.firstChild || n.type.isTop) return null;
	return n.from <= pos && pos <= n.to ? n : null;
}

/**
 * Whether `pos` lies strictly inside a string, comment, macro body or macro call, or inside an
 * unterminated token (which runs to the end of the file); also true at the end of a line
 * comment, where typing continues the comment.
 */
export function inOpaqueToken(tree: Tree, pos: number): boolean {
	for (let n: SyntaxNode | null = tree.resolveInner(pos, -1); n; n = n.parent) {
		if (!OPAQUE_TOKENS.has(n.name)) continue;
		if (n.from < pos && pos < n.to) return true;
		if (pos === n.to && (n.name === 'LineComment' || n.name === 'ScanError')) return true;
	}
	return false;
}

/** The `Keyword` token that covers `pos` (either side), or null. */
export function keywordNodeAt(tree: Tree, pos: number): SyntaxNode | null {
	for (const side of [1, -1] as const) {
		const leaf = leafAt(tree, pos, side);
		if (leaf?.name === 'Keyword') return leaf;
	}
	return null;
}

/**
 * The table entry of a statement keyword node, resolved in the context of its statement.
 * Keywords the table lacks (the deprecated extras of keyword-extras.ts) give null.
 */
export function keywordEntryOf(
	tree: Tree,
	node: SyntaxNode,
	top: TopContextName,
	text: (from: number, to: number) => string,
): KeywordEntry | null {
	const stmt = enclosingStatement(node);
	const ctx = contextAt(tree, stmt ? stmt.from : node.from, top, text);
	if (ctx === null) return null;
	return resolveKeyword(text(node.from, node.to), ctx);
}

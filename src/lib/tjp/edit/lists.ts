// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * List statements of a task or resource body (`depends`, `precedes`, `allocate`, and the
 * `responsible` and `managers` lists the resource intents edit) for deps.ts, allocation.ts and
 * resource-tree.ts, on top of the layout helpers (7.2 list rules):
 *
 * - `itemSpans`: the items of a list statement as the tree has them, so items the index could
 *   not resolve (macro tokens) keep their place.
 * - `removeItems`: removes some items with one adjacent comma each, or the whole statement with
 *   its line when none is left.
 * - `appendOrInsert`: appends `, ref` to the given list statement, else inserts `keyword ref` by
 *   7.2 order. TaskJuggler rejects `depends` and `allocate` once a task has children
 *   (`checkContainer`, ProjectFileParser.rb:127), so in a body that declares children the new
 *   statement never goes after the first of them.
 * - `checkBodyMacros`: `macro-in-body` when a statement-level macro call in the task's bodies
 *   may write one of the list keywords (its definition mentions one, has nested calls, or is
 *   missing), since the edit could not see or fix what the expansion adds (5.4).
 */
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { TjpFile } from '../document';
import type { SymbolIndex, TaskSymbol } from '../index';
import { bodyOf, statementsIn } from '../tree';
import {
	appendListItem,
	insertStatement,
	rankOf,
	removeListItems,
	removeStatement,
	statementNode,
	type Placement,
} from './layout';
import { fileText } from './lines';
import { refused, type EditOp, type Refused, type SourceRange, type Span } from './types';

const ITEM: Readonly<Record<string, string>> = {
	DependsStatement: 'DepItem',
	PrecedesStatement: 'DepItem',
	AllocateStatement: 'AllocItem',
	ResponsibleStatement: 'ResourceRef',
	ManagersStatement: 'ResourceRef',
};

/**
 * The items of a `depends`, `precedes`, `allocate`, `responsible` or `managers` statement, in
 * order; null if it is not one.
 */
export function itemSpans(file: TjpFile, statement: Span): Span[] | null {
	const node = statementNode(file, statement);
	const name = node ? ITEM[node.name] : undefined;
	if (!node || !name) return null;
	const out: Span[] = [];
	for (let c = node.firstChild; c; c = c.nextSibling) {
		if (c.name === name) out.push({ from: c.from, to: c.to });
	}
	return out;
}

const sameSpan = (a: Span, b: Span): boolean => a.from === b.from && a.to === b.to;

/** Removes the items `gone` (by range) of one list statement (module comment). */
export function removeItems(
	file: TjpFile,
	statement: Span,
	gone: readonly Span[],
): EditOp[] | Refused {
	const items = itemSpans(file, statement);
	if (!items) return refused('unknown-target', [{ file: file.path, ...statement }]);
	const idx = items
		.map((s, i) => (gone.some((g) => sameSpan(g, s)) ? i : -1))
		.filter((i) => i >= 0);
	if (idx.length === 0) return [];
	return removeListItems(file, items, idx) ?? [removeStatement(file, statement)];
}

/** Where a new list statement goes in a task body: by rank, but before the first child task. */
export function listPlacement(file: TjpFile, block: Span, keyword: string): Placement {
	const rankPlace: Placement = { scope: 'task', keyword };
	const node = statementNode(file, block);
	const body = node ? bodyOf(node) : null;
	if (!body) return rankPlace;
	const stmts = statementsIn(body);
	const first = stmts.findIndex((s) => s.name === 'TaskStatement');
	if (first < 0) return rankPlace;
	const text = fileText(file);
	const rank = rankOf('task', keyword) ?? 0;
	const later = stmts.slice(first).some((s) => {
		if (s.name === 'TaskStatement' || s.name === 'OpaqueStatement') return false;
		const head = s.firstChild?.name === 'ScenarioPrefix' ? s.firstChild.nextSibling : s.firstChild;
		const r = head?.name === 'Keyword' ? rankOf('task', text.slice(head.from, head.to)) : null;
		return r !== null && r <= rank;
	});
	const child = stmts[first];
	return later && child ? { before: { from: child.from, to: child.to } } : rankPlace;
}

/**
 * Appends `ref` to the list statement `last` (in its file), or inserts `keyword ref` into the
 * declaration `block` when there is none. The ops and the reading position of the new item.
 */
export function appendOrInsert(
	files: (path: string) => TjpFile | undefined,
	last: SourceRange | null,
	block: SourceRange,
	keyword: string,
	ref: string,
): { ops: EditOp[]; at: { file: string; from: number } } | Refused {
	if (last) {
		const file = files(last.file);
		const items = file && itemSpans(file, last);
		if (!file || !items) return refused('unknown-target', [last]);
		const op = appendListItem(file, last, items, ref);
		if ('status' in op) return op;
		return { ops: [op], at: { file: last.file, from: last.from } };
	}
	const file = files(block.file);
	if (!file) return refused('unknown-target', [block]);
	const stmt = `${keyword} ${ref}`;
	const ops = insertStatement(file, block, stmt, listPlacement(file, block, keyword), {
		select: { from: keyword.length + 1, to: stmt.length },
	});
	if ('status' in ops) return ops;
	const first = ops[ops.length - 1];
	return { ops, at: { file: block.file, from: first ? first.from : block.from } };
}

const CALL = /^\$\{(\?)?\s*([A-Za-z_]\w*)/;

/** `macro-in-body` for body macro calls that may write `keywords` (module comment), or null. */
export function checkBodyMacros(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: Pick<TaskSymbol, 'bodyMacroCalls'>,
	keywords: readonly string[],
): Refused | null {
	const at: SourceRange[] = [];
	for (const call of task.bodyMacroCalls) {
		const text = ws.files.get(call.file)?.text.sliceString(call.from, call.to) ?? '';
		const m = CALL.exec(text);
		const defs = m ? index.macros.get(m[2] ?? '') : undefined;
		if (!defs) {
			if (!m?.[1]) at.push(call);
			continue;
		}
		if (defs.some((d) => d.nestedCalls || keywords.some((k) => d.words.has(k)))) at.push(call);
	}
	return at.length > 0 ? refused('macro-in-body', at) : null;
}

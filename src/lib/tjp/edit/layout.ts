// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Layout rules for inserted and removed text (phase-1.md 7.2). Every helper returns one `EditOp`
 * (types.ts) in the file's pre-edit coordinates, or a refusal when the tree around the target is
 * not the shape it expects; apply.ts checks the ops and builds the edit.
 *
 * - Lines break as TaskJuggler reads them (`universal_newline`, 15.14): `\n`, `\r\n` or a lone
 *   `\r`. Inserted text uses the break of the line it lands next to (else the file's most common
 *   one), so CRLF files stay CRLF. Statement text given to the helpers uses `\n` and leading tabs
 *   for nesting (one tab = one indent unit); `renderStatement` turns them into the file's break
 *   and unit.
 * - Indent unit: as format detects it (format.ts `detectIndentUnit`). A body's indentation is that
 *   of its first statement that starts a line, else the header line's plus one unit.
 * - Order (`STATEMENT_ORDER`): a new statement goes after the last statement of equal or lower
 *   rank (opaque, unknown and macro statements are skipped), else before the first higher-ranked
 *   one, and then above the comment lines attached to it; with no ranked statement, at the end.
 * - Bodies: a header without a body gets ` {`, the statement on its own line and `}` at the
 *   header's indentation; inline (` { stmt }`) when the header shares its line with other text.
 *   In a one-line body the statement is added inline.
 * - Removal (`removeStatement`): the statement's lines go when nothing else is on them; a trailing
 *   comment stays (with the indentation); on a shared line only the statement and the blanks on
 *   one side go. Never adds blank lines.
 * - Lists: items are separated by `, `; an append lands after the last item, so a wrapped list
 *   keeps its continuation indentation; a removal takes one adjacent separator.
 * - Values: `replaceValue` keeps the written spelling when it already means the new value
 *   (`keepOrPrint`), which is the `already-set` no-op.
 */
import type { SyntaxNode } from '@lezer/common';
import type { TjpFile } from '../document';
import { OPAQUE_STATEMENTS } from '../grammar/parser';
import { bodyOf, statementKeyword, statementsIn } from '../tree';
import { keepOrPrint, type TypedValue } from '../values';
import {
	attachedStart,
	bodyIndent,
	breakLength,
	fileText,
	indentUnit,
	isBlank,
	isBlankChar,
	isBreak,
	lineBreakNear,
	lineEnd,
	lineIndent,
	lineStart,
	renderStatement,
	startsLine,
	statementNode,
	trailingEnd,
} from './lines';
import { noop, refused, type EditOp, type Noop, type Refused, type Span } from './types';

export * from './lines';

// --- Order -------------------------------------------------------------------------------------

export type OrderScope = 'task' | 'resource' | 'project';

/** Canonical statement order (7.2); one entry per rank. Child declarations rank last. */
export const STATEMENT_ORDER: Readonly<Record<OrderScope, readonly (readonly string[])[]>> = {
	task: [
		['note'],
		['flags'],
		['priority'],
		['responsible'],
		['start'],
		['end'],
		['minstart'],
		['maxend'],
		['scheduling'],
		['milestone'],
		['effort', 'duration', 'length'],
		['depends'],
		['precedes'],
		['allocate'],
		['complete'],
		['task'],
	],
	resource: [
		['email'],
		['managers'],
		['efficiency'],
		['rate'],
		['workinghours'],
		['leaves'],
		['vacation'],
		['resource'],
	],
	project: [
		['timezone'],
		['timeformat'],
		['currency'],
		['now'],
		['dailyworkinghours'],
		['weekstartsmonday'],
		['workinghours'],
	],
};

/** The rank of a keyword in a scope, or null when ranking skips it. */
export function rankOf(scope: OrderScope, keyword: string): number | null {
	const i = STATEMENT_ORDER[scope].findIndex((g) => g.includes(keyword));
	return i < 0 ? null : i;
}

function statementRank(file: TjpFile, scope: OrderScope, stmt: SyntaxNode): number | null {
	if (OPAQUE_STATEMENTS.has(stmt.name) || stmt.name === 'MacroCallStatement') return null;
	const kw = statementKeyword(stmt, fileText(file));
	return kw === null ? null : rankOf(scope, kw);
}

// --- Insert ------------------------------------------------------------------------------------

/** Where a statement goes in a body: by rank, next to a sibling (by range), or at either end. */
export type Placement =
	| { readonly scope: OrderScope; readonly keyword: string }
	| { readonly after: Span }
	| { readonly before: Span }
	| 'start'
	| 'end';

export interface InsertOptions {
	/** Offsets into the statement's first line to select after the edit (default: all of it). */
	readonly select?: Span;
}

const same = (n: SyntaxNode, s: Span): boolean => n.from === s.from && n.to === s.to;

function resolvePlace(
	file: TjpFile,
	stmts: readonly SyntaxNode[],
	place: Placement,
): { after: SyntaxNode | null; before: SyntaxNode | null } | null {
	if (place === 'start') return { after: null, before: stmts[0] ?? null };
	if (place === 'end') return { after: stmts[stmts.length - 1] ?? null, before: null };
	if ('after' in place) {
		const i = stmts.findIndex((s) => same(s, place.after));
		return i < 0 ? null : { after: stmts[i] ?? null, before: stmts[i + 1] ?? null };
	}
	if ('before' in place) {
		const i = stmts.findIndex((s) => same(s, place.before));
		return i < 0 ? null : { after: stmts[i - 1] ?? null, before: stmts[i] ?? null };
	}
	const rank = rankOf(place.scope, place.keyword) ?? STATEMENT_ORDER[place.scope].length;
	let after: SyntaxNode | null = null;
	let before: SyntaxNode | null = null;
	for (const s of stmts) {
		const r = statementRank(file, place.scope, s);
		if (r === null) continue;
		if (r <= rank) after = s;
		else before ??= s;
	}
	if (after) return { after, before: null };
	return before ? { after: null, before } : resolvePlace(file, stmts, 'end');
}

/**
 * Inserts statement text into the body of the statement `owner` (a declaration's block range), or
 * at the top level of the file when `owner` is null, following the layout rules above.
 */
export function insertStatement(
	file: TjpFile,
	owner: Span | null,
	stmt: string,
	place: Placement,
	opts: InsertOptions = {},
): EditOp | Refused {
	const text = fileText(file);
	const unit = indentUnit(file);
	const node = owner ? statementNode(file, owner) : null;
	const at = owner ? [{ file: file.path, from: owner.from, to: owner.to }] : [];
	if (owner && !node) return refused('unknown-target', at);
	const firstLine = stmt.split('\n')[0] ?? '';
	const sel = opts.select ?? { from: 0, to: firstLine.length };
	const op = (pos: number, before: string, body: string, after: string): EditOp => ({
		file: file.path,
		from: pos,
		to: pos,
		insert: before + body + after,
		element: { from: pos, to: pos },
		select: { from: before.length + sel.from, to: before.length + sel.to },
	});
	const eol = lineBreakNear(text, node?.from ?? text.length);
	if (node && !bodyOf(node)) {
		const indent = lineIndent(text, node.from);
		const own = startsLine(text, node.from) && trailingEnd(file, node.to) !== null;
		if (!own) return op(node.to, ' { ', renderStatement(stmt, indent + unit, unit, eol), ' }');
		const inner = indent + unit;
		return op(
			node.to,
			` {${eol}${inner}`,
			renderStatement(stmt, inner, unit, eol),
			eol + indent + '}',
		);
	}
	const container = node ? bodyOf(node) : file.tree.topNode;
	if (!container) return refused('unknown-target', at);
	const open = node ? container.firstChild : null;
	const close = node ? container.lastChild : null;
	if (node && (open?.name !== 'OpenBrace' || close?.name !== 'CloseBrace')) {
		return refused('syntax-error', at);
	}
	const stmts = statementsIn(container);
	const where = resolvePlace(file, stmts, place);
	if (!where) return refused('unknown-target', at);
	const indent = node ? bodyIndent(file, node) : '';
	const body = renderStatement(stmt, indent, unit, eol);
	const { after, before } = where;
	if (open && close && lineStart(text, open.from) === lineStart(text, close.from)) {
		if (after) return op(after.to, ' ', body, '');
		if (before) return op(before.from, '', body, ' ');
		return op(close.from, isBlankChar(text[close.from - 1]) ? '' : ' ', body, ' ');
	}
	if (after) {
		const end = trailingEnd(file, after.to);
		if (end === null) return op(after.to, ' ', body, '');
		const le = lineEnd(text, end);
		const n = breakLength(text, le);
		const lb = lineBreakNear(text, after.to);
		return n > 0 ? op(le + n, indent, body, lb) : op(le, lb + indent, body, '');
	}
	if (before) {
		if (!startsLine(text, before.from)) return op(before.from, '', body, ' ');
		return op(attachedStart(file, before), indent, body, lineBreakNear(text, before.from));
	}
	if (close) {
		if (startsLine(text, close.from)) return op(lineStart(text, close.from), indent, body, eol);
		return op(close.from, isBlankChar(text[close.from - 1]) ? '' : ' ', body, ' ');
	}
	const ends = text.length === 0 || isBreak(text[text.length - 1]);
	return op(text.length, ends ? '' : eol, body, eol);
}

// --- Remove ------------------------------------------------------------------------------------

export interface RemoveOptions {
	/** Comment lines attached above the statement (`DeclSite.leadingComments`), removed with it. */
	readonly leading?: Span | null;
}

/** Removes a statement with its line (module comment). */
export function removeStatement(file: TjpFile, stmt: Span, opts: RemoveOptions = {}): EditOp {
	const text = fileText(file);
	const start = opts.leading ? Math.min(opts.leading.from, stmt.from) : stmt.from;
	const ls = lineStart(text, start);
	const trail = trailingEnd(file, stmt.to);
	const op = (from: number, to: number): EditOp => ({
		file: file.path,
		from,
		to,
		insert: '',
		element: { from: stmt.from, to: stmt.to },
	});
	let next = stmt.to;
	while (isBlankChar(text[next])) next++;
	if (trail === null) return op(start, next);
	if (!isBlank(text.slice(ls, start))) {
		let prev = start;
		while (prev > ls && isBlankChar(text[prev - 1])) prev--;
		return op(prev, stmt.to);
	}
	if (next < text.length && !isBreak(text[next])) return op(start, next);
	const le = lineEnd(text, stmt.to);
	return op(ls, le + breakLength(text, le));
}

// --- Replace -----------------------------------------------------------------------------------

/** Replaces a span (a token, a name, a value) with text; the span is the element. */
export function replaceSpan(
	file: TjpFile,
	span: Span,
	insert: string,
	opts: { select?: Span } = {},
): EditOp {
	return {
		file: file.path,
		from: span.from,
		to: span.to,
		insert,
		element: { from: span.from, to: span.to },
		select: opts.select ?? { from: 0, to: insert.length },
	};
}

/**
 * Rewrites a value (`AttrSite.value`) to mean `next`, keeping the written spelling when it already
 * does (noop `already-set`); `invalid-value` when `next` has no text.
 */
export function replaceValue(
	file: TjpFile,
	value: Span,
	next: TypedValue,
): EditOp | Noop | Refused {
	const written = fileText(file).slice(value.from, value.to);
	const r = keepOrPrint(written, next);
	if (!r.ok) return refused('invalid-value', [{ file: file.path, ...value }]);
	if (!r.value.changed) return noop('already-set');
	return replaceSpan(file, value, r.value.text);
}

// --- Lists -------------------------------------------------------------------------------------

/** Appends `, item` after the last item of a list statement; the statement is the element. */
export function appendListItem(
	file: TjpFile,
	statement: Span,
	items: readonly Span[],
	item: string,
): EditOp | Refused {
	const last = items[items.length - 1];
	if (!last) return refused('unsupported-form', [{ file: file.path, ...statement }]);
	return {
		file: file.path,
		from: last.to,
		to: last.to,
		insert: `, ${item}`,
		element: { from: statement.from, to: statement.to },
		select: { from: 2, to: 2 + item.length },
	};
}

/**
 * Removes item `index` of a list with one adjacent separator, or returns null when it is the only
 * item (the caller removes the statement instead).
 */
export function removeListItem(
	file: TjpFile,
	items: readonly Span[],
	index: number,
): EditOp | null {
	const item = items[index];
	if (!item || items.length < 2) return null;
	const next = items[index + 1];
	const prev = items[index - 1];
	const [from, to] = next ? [item.from, next.from] : [prev?.to ?? item.from, item.to];
	return {
		file: file.path,
		from,
		to,
		insert: '',
		element: { from: item.from, to: item.to },
	};
}

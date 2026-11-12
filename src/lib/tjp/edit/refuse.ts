// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The refusal pipeline every edit goes through (phase-1.md 5.4, 7.1; 15.8, 15.10). `checkOps`
 * runs, in this order, and the first refusal wins:
 *
 * 1. Freshness: the index must be built from the snapshot (`stale`). Base versions are recorded
 *    in the edit; `Workspace.apply` answers 'stale' when one has moved since.
 * 2. For each op: its file exists (`unknown-target`); neither its element (a value, statement,
 *    item, block or insertion point) nor its change range (the element widened by its line,
 *    leading comments or separator) is blocked by a text-only range (`text-only`, or
 *    `syntax-error` for an X6 range); the innermost statement around the element holds no error
 *    node (`syntax-error`; an insertion point counts the statement whose body it is in); and the
 *    op leaves the line break after a macro body's `]` alone (grammar/scanner.ts: it closes the
 *    body), unless it removes the body with it (`text-only`, `macro-body`).
 * 3. Shared text: an op in a file TaskJuggler reads in several include visits (15.8) edits every
 *    declaration that text gives, so it is refused (`shared-declaration`, with the ids in
 *    `affects`) unless the caller confirms with `EditOptions.confirmShared`.
 *
 * Helpers for intents: `validValue` (parse and check a keyword's value text against the project
 * context at the target) and `checkSafeText` (names and other inserted strings).
 */
import type { SyntaxNode } from '@lezer/common';
import type { TjpFile } from '../document';
import { isStatement } from '../tree';
import { KEYWORD_VALUE_KIND, checkValue, parseValue, type TypedValue } from '../values';
import { breakLength, fileText } from './lines';
import {
	refused,
	type EditContext,
	type EditOp,
	type Refused,
	type SourceRange,
	type Span,
	type WorkspacePath,
} from './types';

const range = (file: WorkspacePath, s: Span): SourceRange => ({ file, from: s.from, to: s.to });

/** The span an op declares as its target: its element and its change together. */
export function opTarget(op: EditOp): Span {
	if (op.target) return op.target;
	return { from: Math.min(op.element.from, op.from), to: Math.max(op.element.to, op.to) };
}

/** `stale` when the index was built from another workspace version than the snapshot. */
export function checkFresh(ctx: EditContext): Refused | null {
	return ctx.index.version === ctx.ws.version ? null : refused('stale');
}

/** The text-only range that blocks editing `span` in `file`, as a refusal. */
export function checkTextOnly(ctx: EditContext, file: WorkspacePath, span: Span): Refused | null {
	const t = ctx.index.blocking(file, span.from, span.to);
	if (!t) return null;
	return refused(t.reason === 'syntax-error' ? 'syntax-error' : 'text-only', [t.at], {
		textOnly: t.reason,
	});
}

/**
 * The innermost statement around `span`: one that contains it, strictly for an insertion point
 * (so a point between statements of a body gives the body's owner). Null at the top level.
 */
export function statementAround(file: TjpFile, span: Span): SyntaxNode | null {
	const point = span.from === span.to;
	for (
		let n: SyntaxNode | null = file.tree.resolveInner(span.from, point ? 0 : 1);
		n;
		n = n.parent
	) {
		if (!isStatement(n)) continue;
		const inside = point
			? n.from < span.from && span.from < n.to
			: n.from <= span.from && span.to <= n.to;
		if (inside) return n;
	}
	return null;
}

/** The first error node inside `node` (a descendant), or null. */
export function errorInside(file: TjpFile, node: SyntaxNode): SyntaxNode | null {
	let found: SyntaxNode | null = null;
	file.tree.iterate({
		from: node.from,
		to: node.to,
		enter(ref) {
			if (found) return false;
			if (!ref.type.isError) return;
			for (let p: SyntaxNode | null = ref.node; p; p = p.parent) {
				if (p.from === node.from && p.to === node.to && p.type === node.type) {
					found = ref.node;
					return false;
				}
			}
			return;
		},
	});
	return found;
}

/** `syntax-error` when the statement around `span` holds an error node. */
export function checkStatementErrors(file: TjpFile, span: Span): Refused | null {
	const stmt = statementAround(file, span);
	const err = stmt && errorInside(file, stmt);
	return err ? refused('syntax-error', [range(file.path, err)]) : null;
}

/**
 * Refuses an op that touches the line break closing a macro body: text inserted between the `]`
 * and its break, or the break removed or replaced, unless the op removes the whole body with it.
 */
export function checkMacroBreaks(file: TjpFile, op: EditOp): Refused | null {
	const text = fileText(file);
	let bad: SyntaxNode | null = null;
	file.tree.iterate({
		from: Math.max(0, op.from - 1),
		to: Math.min(text.length, op.to + 1),
		enter(ref) {
			if (bad || ref.name !== 'MacroBody') return;
			const p = ref.to;
			const n = breakLength(text, p);
			if (n === 0) return;
			const clear = op.to < p || op.from >= p + n || (op.to === p && op.from < p);
			const whole = op.from <= ref.from && op.to >= p + n;
			if (!clear && !whole) bad = ref.node;
		},
	});
	if (!bad) return null;
	const at = range(file.path, bad);
	return refused('text-only', [at], { textOnly: 'macro-body' });
}

/** The checks of step 2 for one op. */
export function checkOp(ctx: EditContext, op: EditOp): Refused | null {
	const file = ctx.ws.files.get(op.file);
	if (!file) return refused('unknown-target');
	if (op.from > op.to || op.to > file.text.length) {
		throw new RangeError(`edit op ${op.from}-${op.to} does not fit ${op.file}`);
	}
	return (
		checkTextOnly(ctx, op.file, op.element) ??
		(op.from === op.element.from && op.to === op.element.to
			? null
			: checkTextOnly(ctx, op.file, op)) ??
		checkStatementErrors(file, op.element) ??
		checkMacroBreaks(file, op)
	);
}

/** How many include visits read each file. */
function visitCounts(ctx: EditContext): Map<WorkspacePath, number> {
	const out = new Map<WorkspacePath, number>();
	for (const v of ctx.index.visits) out.set(v.file, (out.get(v.file) ?? 0) + 1);
	return out;
}

const within = (outer: SourceRange, file: WorkspacePath, s: Span): boolean =>
	outer.file === file && outer.from <= s.from && s.to <= outer.to;

/** Step 3: `shared-declaration` for ops in files read in several visits, unless confirmed. */
export function checkShared(ctx: EditContext, ops: readonly EditOp[]): Refused | null {
	if (ctx.opts.confirmShared) return null;
	const counts = visitCounts(ctx);
	const at: SourceRange[] = [];
	const affects = new Set<string>();
	for (const op of ops) {
		if ((counts.get(op.file) ?? 0) < 2) continue;
		const t = opTarget(op);
		at.push(range(op.file, t));
		for (const map of [ctx.index.tasks, ctx.index.resources]) {
			for (const sym of map.values()) {
				const blocks = [sym.decl.block, ...sym.supplements.map((s) => s.block)];
				if (!blocks.some((b) => within(b, op.file, t))) continue;
				affects.add(sym.id);
				for (const id of sym.sharedWith) affects.add(id);
			}
		}
	}
	if (at.length === 0) return null;
	return refused('shared-declaration', at, { affects: [...affects] });
}

/** The whole pipeline (module comment) over an intent's ops. */
export function checkOps(ctx: EditContext, ops: readonly EditOp[]): Refused | null {
	const fresh = checkFresh(ctx);
	if (fresh) return fresh;
	for (const op of ops) {
		const r = checkOp(ctx, op);
		if (r) return r;
	}
	return checkShared(ctx, ops);
}

/** `unsafe-text` for inserted strings that would expand macros or break lines (7.1 renameTask). */
export function checkSafeText(s: string, at: readonly SourceRange[] = []): Refused | null {
	return /\$\{|\$\(|[\n\r]/.test(s) ? refused('unsafe-text', at) : null;
}

/**
 * Parses `text` as the value of `keyword` and runs TaskJuggler's checks for it with the project
 * context at `at`; `invalid-value` (at `at`) when either fails. Throws for keywords without a
 * typed value.
 */
export function validValue(
	ctx: EditContext,
	keyword: string,
	text: string,
	at: SourceRange,
): TypedValue | Refused {
	const kind = KEYWORD_VALUE_KIND[keyword];
	if (!kind) throw new Error(`no typed value for ${keyword}`);
	const p = parseValue(kind, text);
	if (!p.ok) return refused('invalid-value', [at]);
	const c = checkValue(keyword, p.value, ctx.index.contextAt(at.file, at.from));
	return c.ok ? p.value : refused('invalid-value', [at]);
}

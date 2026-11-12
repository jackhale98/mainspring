// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Attribute sites of resources and of the project for the T11d intents (resource-attrs.ts,
 * project.ts, calendar.ts), the same rules the task attribute intents follow (5.4, 7.1, 7.2):
 *
 * - Own sites: the declaration and supplement bodies (for the project, its header body and the
 *   files included in it), in reading order. An unprefixed site and one prefixed with the top
 *   scenario are the same; other scenarios' sites are never edited (`ownSites`).
 * - A site written with a macro, or in a declaration the index cannot name, is `text-only`
 *   (`macroWritten`).
 * - New statements go into the declaration body by the 7.2 order, but before the first statement
 *   of another scenario that sets the same attribute in that body: a top-scenario value read later
 *   is copied over the other scenario's value (PropertyTreeNode#[]= in provided mode), so an
 *   insertion after it would silently change that scenario (`insertAttr`).
 * - Removal takes every own site with its line, file by file (`removeSites`).
 * - Inheritance: TaskJuggler copies a parent's inheritable attributes into a child when it creates
 *   the child (PropertyTreeNode#inheritAttributes), so only the parent's sites read before the
 *   child's header count (`inheritedSites`).
 */
import { compareParseOrder } from '../../workspace/include-order';
import type { TjpFile } from '../document';
import type { AttrSite, ResourceSymbol, SourceRange, SymbolIndex } from '../index';
import { insertStatement, removeStatements, type OrderScope, type Removal } from './layout';
import { isRefused, refused, type EditContext, type EditOp, type Refused } from './types';

export const topOf = (index: SymbolIndex): string | null => index.scenarios[0]?.id ?? null;

const has = (keywords: ReadonlySet<string> | string, k: string): boolean =>
	typeof keywords === 'string' ? k === keywords : keywords.has(k);

/** Own sites of these keywords in the top scenario, in reading order. */
export function ownSites(
	index: SymbolIndex,
	attrs: readonly AttrSite[],
	keywords: ReadonlySet<string> | string,
): AttrSite[] {
	const top = topOf(index);
	return attrs.filter(
		(a) => has(keywords, a.keyword) && (a.scenario === null || a.scenario === top),
	);
}

/** Sites of these keywords in other scenarios (`delayed:efficiency`), in reading order. */
export function otherScenarioSites(
	index: SymbolIndex,
	attrs: readonly AttrSite[],
	keywords: ReadonlySet<string> | string,
): AttrSite[] {
	const top = topOf(index);
	return attrs.filter((a) => has(keywords, a.keyword) && a.scenario !== null && a.scenario !== top);
}

export const ranges = (sites: readonly AttrSite[]): SourceRange[] => sites.map((s) => s.statement);

/** `text-only` at the first site written with a macro or inside an unnamed declaration. */
export function macroWritten(sites: readonly AttrSite[]): Refused | null {
	const s = sites.find((x) => x.textOnly !== null);
	return s?.textOnly ? refused('text-only', [s.statement], { textOnly: s.textOnly.reason }) : null;
}

export function fileOf(ctx: EditContext, at: SourceRange): TjpFile | Refused {
	return ctx.ws.files.get(at.file) ?? refused('unknown-target', [at]);
}

/** The resource an intent names; `text-only` for one declared only through macro expansion. */
export function resourceOf(ctx: EditContext, id: string): ResourceSymbol | Refused {
	const sym = ctx.index.resources.get(id);
	if (!sym) return refused('unknown-target');
	if (sym.expandedOnly)
		return refused('text-only', [sym.decl.block], { textOnly: 'expanded-only' });
	return sym;
}

const inside = (r: SourceRange, o: SourceRange): boolean =>
	r.file === o.file && o.from <= r.from && r.to <= o.to;

/** Where the last op of an insertion is read, as a point. */
export function pointOf(ops: readonly EditOp[]): SourceRange | null {
	const last = ops[ops.length - 1];
	return last ? { file: last.file, from: last.from, to: last.from } : null;
}

/** Whether `a` is read before `b` (first include visits). */
export function readBefore(ctx: EditContext, a: SourceRange, b: SourceRange): boolean {
	return compareParseOrder(ctx.ws.includes, a, b, 'first') < 0;
}

/**
 * Inserts `text` (keyword first) into the body of `block` by the 7.2 order of `scope`, but before
 * the first statement of that body in `others` (sites of the attribute in other scenarios).
 */
export function insertAttr(
	ctx: EditContext,
	block: SourceRange,
	scope: OrderScope,
	keyword: string,
	text: string,
	others: readonly AttrSite[],
): EditOp[] | Refused {
	const file = fileOf(ctx, block);
	if (isRefused(file)) return file;
	const select = { from: text === keyword ? 0 : keyword.length + 1, to: text.length };
	const ops = insertStatement(file, block, text, { scope, keyword }, { select });
	if (isRefused(ops)) return ops;
	const first = others.find((s) => inside(s.statement, block));
	const at = pointOf(ops);
	if (!first || !at || at.from <= first.statement.from) return ops;
	return insertStatement(file, block, text, { before: first.statement }, { select });
}

/** Removes sites with their lines, file by file. */
export function removeSites(ctx: EditContext, sites: readonly AttrSite[]): EditOp[] | Refused {
	const byFile = new Map<string, Removal[]>();
	for (const s of sites) {
		const list = byFile.get(s.statement.file) ?? [];
		list.push({ stmt: s.statement });
		byFile.set(s.statement.file, list);
	}
	const out: EditOp[] = [];
	for (const [path, list] of byFile) {
		const file = ctx.ws.files.get(path);
		if (!file) return refused('unknown-target');
		out.push(...removeStatements(file, list));
	}
	return out;
}

/** The resource's ancestors, nearest first, each with the header of its child on the path. */
export function resourceAncestors(
	ctx: EditContext,
	sym: ResourceSymbol,
): Array<{ readonly res: ResourceSymbol; readonly before: SourceRange }> {
	const out: Array<{ res: ResourceSymbol; before: SourceRange }> = [];
	let child = sym;
	for (let p = sym.parent; p !== null;) {
		const up = ctx.index.resources.get(p);
		if (!up) break;
		out.push({ res: up, before: child.decl.header });
		child = up;
		p = up.parent;
	}
	return out;
}

/**
 * The ancestor sites `sym` inherits `keyword` from: the nearest ancestor's own sites read before
 * its child on the path was created, or, for an accumulating list (`managers`), every ancestor's.
 */
export function inheritedSites(
	ctx: EditContext,
	sym: ResourceSymbol,
	keyword: string,
	accumulating = false,
): AttrSite[] {
	const out: AttrSite[] = [];
	for (const step of resourceAncestors(ctx, sym)) {
		const own = ownSites(ctx.index, step.res.attrs, keyword).filter((s) =>
			readBefore(ctx, s.statement, step.before),
		);
		if (own.length === 0) continue;
		if (!accumulating) return own;
		out.push(...own);
	}
	return out;
}

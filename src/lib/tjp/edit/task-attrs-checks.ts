// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the task attribute intents (task-attrs.ts) read about a task: the task itself, its own
 * sites in the top scenario, what it inherits, the statement-level macro rule, and the
 * `conflicting-attribute` checks that need no timing model (TaskScenario.rb prepareScenario and
 * markAsMilestone; the timing checks are in task-attrs-timing.ts):
 *
 * - `isContainer`: a container may have no sizing criterion and may not be a milestone
 *   (`container_duration`, `container_milestone`); children the index cannot name (auto ids)
 *   count.
 * - `fixedBounds`: a milestone's start and end must be identical (`milestone_start_end`).
 * - `bookingsOf`: the bookings of a task, in its bodies or in resource bodies naming it.
 * - Inheritance (`inheritedSites`, `inheritedIds`): TaskJuggler copies a parent's inheritable
 *   attributes into a child when it creates the child (PropertyTreeNode#inheritAttributes), so
 *   only the parent's sites read before the child's header count, and the parent's own value at
 *   that point includes what it inherited itself. Single-valued attributes take the nearest such
 *   ancestor; `flags` and `responsible` accumulate along the chain.
 * - `macroInBody` (5.4): a statement-level macro call in the task's bodies blocks an edit of
 *   `keywords` unless the macro is defined once, its body has no nested calls or arguments, and
 *   none of its words is one of `keywords`.
 */
import type { TjpFile } from '../document';
import {
	lastSite,
	type AttrSite,
	type ReferenceVia,
	type SourceRange,
	type TaskSymbol,
} from '../index';
import { sameValue, type TypedValue } from '../values';
import { readBefore } from './task-attrs-value';
import { refused, type EditContext, type Refused } from './types';

export const SIZING: ReadonlySet<string> = new Set(['effort', 'length', 'duration']);

export const ranges = (sites: readonly AttrSite[]): SourceRange[] => sites.map((s) => s.statement);

export function fileOf(ctx: EditContext, at: SourceRange): TjpFile | Refused {
	return ctx.ws.files.get(at.file) ?? refused('unknown-target', [at]);
}

/** The task an intent names; `text-only` for one declared only through macro expansion. */
export function taskOf(ctx: EditContext, id: string): TaskSymbol | Refused {
	const sym = ctx.index.tasks.get(id);
	if (!sym) return refused('unknown-target');
	if (sym.expandedOnly)
		return refused('text-only', [sym.decl.block], { textOnly: 'expanded-only' });
	return sym;
}

export const topOf = (ctx: EditContext): string | null => ctx.index.scenarios[0]?.id ?? null;

const has = (keywords: ReadonlySet<string> | string, k: string): boolean =>
	typeof keywords === 'string' ? k === keywords : keywords.has(k);

/** The task's own sites of these keywords in the top scenario, in reading order. */
export function ownSites(
	ctx: EditContext,
	sym: TaskSymbol,
	keywords: ReadonlySet<string> | string,
): AttrSite[] {
	const top = topOf(ctx);
	return sym.attrs.filter(
		(a) => has(keywords, a.keyword) && (a.scenario === null || a.scenario === top),
	);
}

/** The task's sites of these keywords in other scenarios (`late:effort`), in reading order. */
export function otherScenarioSites(
	ctx: EditContext,
	sym: TaskSymbol,
	keywords: ReadonlySet<string> | string,
): AttrSite[] {
	const top = topOf(ctx);
	return sym.attrs.filter(
		(a) => has(keywords, a.keyword) && a.scenario !== null && a.scenario !== top,
	);
}

/** The last own site of `keyword` in the top scenario (`lastSite`). */
export function lastOwn(ctx: EditContext, sym: TaskSymbol, keyword: string): AttrSite | null {
	return lastSite(sym.attrs, keyword, null, topOf(ctx));
}

const inside = (r: SourceRange, o: SourceRange): boolean =>
	r.file === o.file && o.from <= r.from && r.to <= o.to;

/** Whether the task has children, also ones the index cannot name (auto ids, macro ids). */
export function isContainer(ctx: EditContext, sym: TaskSymbol): boolean {
	if (sym.children.length > 0) return true;
	const blocks = [sym.decl.block, ...sym.supplements.map((s) => s.block)];
	return ctx.index.unresolved.some(
		(u) =>
			u.kind === 'task' && (u.parent === sym.id || blocks.some((b) => inside(u.decl.block, b))),
	);
}

/** `booking` statements of the task, in its bodies and in resource bodies naming it. */
export function bookingsOf(ctx: EditContext, sym: TaskSymbol): SourceRange[] {
	const out = ranges(sym.attrs.filter((a) => a.keyword === 'booking'));
	for (const res of ctx.index.resources.values()) {
		for (const a of res.attrs) {
			if (a.keyword !== 'booking' || !a.value) continue;
			const text = ctx.ws.files.get(a.value.file)?.text.sliceString(a.value.from, a.value.to);
			if (text?.trim().split(/[\s,]/)[0] === sym.id) out.push(a.statement);
		}
	}
	return out;
}

/**
 * The own `start` and `end` sites when both are set and differ, with `next` replacing one of
 * them; null when a milestone may have them.
 */
export function fixedBounds(
	ctx: EditContext,
	sym: TaskSymbol,
	next?: { readonly keyword: string; readonly value: TypedValue },
): SourceRange[] | null {
	const keys = ['start', 'end'];
	const sites = keys.map((k) => lastOwn(ctx, sym, k));
	const values = sites.map((s, i) =>
		next && next.keyword === keys[i] ? next.value : (s?.parsed ?? null),
	);
	const [a, b] = values;
	if (!a || !b || sameValue(a, b)) return null;
	return sites.flatMap((s) => (s ? [s.statement] : []));
}

// --- Inheritance -------------------------------------------------------------------------------

/** One ancestor step: the ancestor and the position its child was created at. */
export interface AncestorStep {
	readonly task: TaskSymbol;
	readonly before: SourceRange;
}

/** The ancestors, nearest first, each with the header of the child on the path to `sym`. */
export function ancestorSteps(ctx: EditContext, sym: TaskSymbol): AncestorStep[] {
	const out: AncestorStep[] = [];
	let child = sym;
	for (let p = sym.parent; p !== null;) {
		const up = ctx.index.tasks.get(p);
		if (!up) break;
		out.push({ task: up, before: child.decl.header });
		child = up;
		p = up.parent;
	}
	return out;
}

/** Own top-scenario sites of `keyword` of an ancestor read before its child was created. */
export function sitesBefore(ctx: EditContext, step: AncestorStep, keyword: string): AttrSite[] {
	return ownSites(ctx, step.task, keyword).filter((s) => readBefore(ctx, s.statement, step.before));
}

/**
 * The sites `sym` inherits `keyword` from: the nearest ancestor's own sites read before its
 * child on the path was created; for the accumulating `flags` and `responsible`, those of every
 * ancestor.
 */
export function inheritedSites(ctx: EditContext, sym: TaskSymbol, keyword: string): AttrSite[] {
	const out: AttrSite[] = [];
	for (const step of ancestorSteps(ctx, sym)) {
		const own = sitesBefore(ctx, step, keyword);
		if (own.length === 0) continue;
		if (!ACCUMULATING.has(keyword)) return own;
		out.push(...own);
	}
	return out;
}

/** Task attributes TaskJuggler inherits from the parent task (Project.rb, `Inh.` column). */
export const INHERITED: ReadonlySet<string> = new Set([
	'flags',
	'scheduling',
	'maxend',
	'minstart',
	'priority',
	'responsible',
]);

/** List attributes whose statements add to the value instead of replacing it. */
export const ACCUMULATING: ReadonlySet<string> = new Set(['flags', 'responsible']);

/** The ids a `flags` or `responsible` site gives (resolved resource ids, flag names). */
export function siteIds(ctx: EditContext, site: AttrSite): string[] {
	const via = site.keyword as ReferenceVia;
	return ctx.index.references
		.filter((r) => r.via === via && inside(r.at, site.statement))
		.map((r) => r.target ?? r.written);
}

/** The ids `sym` inherits for a list attribute, each with the sites that give it. */
export function inheritedIds(
	ctx: EditContext,
	sym: TaskSymbol,
	keyword: 'flags' | 'responsible',
): Map<string, AttrSite[]> {
	const out = new Map<string, AttrSite[]>();
	for (const site of inheritedSites(ctx, sym, keyword)) {
		for (const id of siteIds(ctx, site)) out.set(id, [...(out.get(id) ?? []), site]);
	}
	return out;
}

/**
 * `text-only` (5.4 X1 to X4) at the first of the sites an edit rewrites or removes that is
 * written with a macro or lies in a declaration the index cannot name, or null.
 */
export function macroWritten(sites: readonly AttrSite[]): Refused | null {
	const s = sites.find((x) => x.textOnly !== null);
	return s?.textOnly ? refused('text-only', [s.statement], { textOnly: s.textOnly.reason }) : null;
}

// --- Statement-level macro calls ---------------------------------------------------------------

const CALL_NAME = /^\$\{\??\s*([A-Za-z_]\w*)\s*\}$/;

/**
 * `macro-in-body` (module comment) for an edit of `keywords`: the calls in the task's bodies
 * whose expansion could hold one of them, or null when there are none.
 */
export function macroInBody(
	ctx: EditContext,
	sym: TaskSymbol,
	keywords: ReadonlySet<string>,
): Refused | null {
	const bad = sym.bodyMacroCalls.filter((call) => {
		const text = ctx.ws.files.get(call.file)?.text.sliceString(call.from, call.to).trim() ?? '';
		const name = CALL_NAME.exec(text)?.[1];
		const defs = name === undefined ? undefined : ctx.index.macros.get(name);
		const def = defs?.length === 1 ? defs[0] : undefined;
		if (!def || def.nestedCalls) return true;
		return [...keywords].some((k) => def.words.has(k));
	});
	return bad.length > 0 ? refused('macro-in-body', bad) : null;
}

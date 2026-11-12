// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `setResourceAttr` and `removeResourceAttr` (phase-1.md 7.1: "as `setAttr`/`removeAttr`"), for
 * `efficiency`, `rate`, `email` and `managers`. Sites as props.ts describes them.
 *
 * - Values are TaskJuggler text, as for `setAttr`: `'1.5'`, `'"ann@example.com"'`; `managers`
 *   takes an id or a list of ids. Text that does not parse as the keyword's value is
 *   `invalid-value`. TaskJuggler's number rule has no sign, so a negative efficiency or rate does
 *   not parse (checked natively).
 * - `efficiency`, `rate`, `email`: the last own site's value is rewritten, keeping the written
 *   spelling when it already means the value (noop `already-set`), else `keyword value` is
 *   inserted (props.ts `insertAttr`).
 * - `managers` accumulates (rule `managers`: `+ @val[1]`) and is inherited from the parent
 *   resource. The value is the resource's whole list: inherited ids must stay (`inherited`); the
 *   last own list is rewritten to the value and the other own lists are removed, or `managers`
 *   is inserted; noop when own and inherited ids are already the value. Every id must name a
 *   leaf resource outside this one's subtree (`invalid-value`: TaskJuggler reports
 *   resource_id_expected, manager_is_group and manager_is_self, ResourceScenario.rb:92-105; a
 *   group's managers apply to its children, so a child named on the group manages itself).
 *   Managers may be declared later (rule_undefResourceId resolves them after parsing). Ids are
 *   written relative to the file's `resourceprefix`; one outside it cannot be written there
 *   (`invalid-value`). A value that adds an edge leading to a loop of managers is `cycle`
 *   (manager-loops.ts: TaskJuggler recurses through the loop until the stack overflows).
 * - `removeResourceAttr` removes every own site (with its line); with none it is `inherited`
 *   when an ancestor sets an inheritable attribute (efficiency, rate, managers) before the
 *   resource was created, else noop `not-present`.
 * - A statement-level macro call in the resource's bodies whose expansion may hold the keyword
 *   is `macro-in-body` (lists.ts `checkBodyMacros`).
 *
 * Shared files (15.16): value rewrites of `efficiency`, `rate` and `email` mean the same in every
 * include visit; the id-valued `managers` does not.
 */
import type { AttrSite, ResourceSymbol, SourceRange } from '../index';
import { isId, parseValue, printValue, KEYWORD_VALUE_KIND, type TypedValue } from '../values';
import type { IntentHandler } from './apply';
import { replaceValue } from './layout';
import { checkBodyMacros } from './lists';
import { managerLoop } from './manager-loops';
import {
	fileOf,
	inheritedSites,
	insertAttr,
	macroWritten,
	otherScenarioSites,
	ownSites,
	ranges,
	removeSites,
	resourceOf,
} from './props';
import { subtree } from './refs';
import {
	isRefused,
	noop,
	refused,
	type AttrValue,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type Refused,
	type ResourceAttr,
} from './types';

const INHERITED: ReadonlySet<ResourceAttr> = new Set(['efficiency', 'rate', 'managers']);

function insertValue(
	ctx: EditContext,
	sym: ResourceSymbol,
	keyword: string,
	text: string,
): EditOp[] | Refused {
	const others = otherScenarioSites(ctx.index, sym.attrs, keyword);
	return insertAttr(ctx, sym.decl.block, 'resource', keyword, `${keyword} ${text}`, others);
}

/** The intent's value parsed as the keyword's value, or `invalid-value` at `at`. */
function parsed(
	keyword: string,
	value: AttrValue,
	at: readonly SourceRange[],
): TypedValue | Refused {
	const kind = KEYWORD_VALUE_KIND[keyword];
	if (!kind || typeof value !== 'string') return refused('invalid-value', at);
	const p = parseValue(kind, value);
	return p.ok ? p.value : refused('invalid-value', at);
}

/** The ids `site` gives (resolved resource ids, else as written). */
function siteIds(ctx: EditContext, site: AttrSite): string[] {
	const s = site.statement;
	return ctx.index.references
		.filter(
			(r) => r.via === 'managers' && r.at.file === s.file && s.from <= r.at.from && r.at.to <= s.to,
		)
		.map((r) => r.target ?? r.written);
}

/** `managers` ids written in the file of `at` (its `resourceprefix` stripped). */
function writtenIds(ctx: EditContext, ids: readonly string[], at: SourceRange): string[] | Refused {
	const prefix = ctx.index.visits.find((v) => v.file === at.file)?.resourcePrefix;
	if (!prefix || prefix.kind === 'none') return [...ids];
	if (prefix.kind === 'unknown') return refused('invalid-value', [at]);
	const out: string[] = [];
	for (const id of ids) {
		if (!id.startsWith(`${prefix.id}.`)) return refused('invalid-value', [at]);
		out.push(id.slice(prefix.id.length + 1));
	}
	return out;
}

/** The managers of a value, deduplicated, each a leaf resource other than `sym`. */
function managerIds(
	ctx: EditContext,
	sym: ResourceSymbol,
	value: AttrValue,
	at: readonly SourceRange[],
): string[] | Refused {
	if (typeof value === 'boolean') return refused('invalid-value', at);
	const ids = [...new Set(typeof value === 'string' ? [value] : value)];
	if (ids.length === 0 || !ids.every(isId)) return refused('invalid-value', at);
	const own = new Set(subtree(ctx.index, 'resource', sym.id));
	for (const id of ids) {
		const r = ctx.index.resources.get(id);
		if (!r || own.has(id) || r.children.length > 0) return refused('invalid-value', at);
	}
	return ids;
}

/** The manager ids an `addResource` attribute list gives (as written; checked later). */
export function managersIn(attrs: ReadonlyArray<readonly [ResourceAttr, AttrValue]>): string[] {
	return attrs.flatMap(([a, v]) =>
		a !== 'managers' || typeof v === 'boolean' ? [] : typeof v === 'string' ? [v] : [...v],
	);
}

const sameSet = (a: ReadonlySet<string>, b: readonly string[]): boolean =>
	a.size === new Set(b).size && b.every((x) => a.has(x));

function planManagers(ctx: EditContext, sym: ResourceSymbol, value: AttrValue): IntentPlan {
	const own = ownSites(ctx.index, sym.attrs, 'managers');
	const macro = macroWritten(own);
	if (macro) return macro;
	const last = own[own.length - 1];
	const at = [last?.value ?? sym.decl.header];
	const ids = managerIds(ctx, sym, value, at);
	if (isRefused(ids)) return ids;
	const loop = managerLoop(ctx.index, { own: new Map([[sym.id, ids]]) });
	if (loop) return loop;
	const up = inheritedSites(ctx, sym, 'managers', true);
	const upIds = new Set(up.flatMap((s) => siteIds(ctx, s)));
	const lost = up.filter((s) => siteIds(ctx, s).some((id) => !ids.includes(id)));
	if (lost.length > 0) return refused('inherited', ranges(lost));
	const now = new Set([...own.flatMap((s) => siteIds(ctx, s)), ...upIds]);
	if (sameSet(now, ids)) return noop('already-set');
	if (!last) {
		const text = writtenIds(ctx, ids, sym.decl.block);
		return isRefused(text) ? text : insertValue(ctx, sym, 'managers', text.join(', '));
	}
	if (!last.value) return refused('unsupported-form', at);
	const file = fileOf(ctx, last.statement);
	if (isRefused(file)) return file;
	const text = writtenIds(ctx, ids, last.statement);
	if (isRefused(text)) return text;
	const op = replaceValue(file, last.value, { kind: 'idList', value: text });
	if (isRefused(op)) return op;
	const others = removeSites(ctx, own.slice(0, -1));
	if (isRefused(others)) return others;
	const ops = 'status' in op ? others : [op, ...others];
	return ops.length > 0 ? ops : noop('already-set');
}

export function planSetResourceAttr(
	ctx: EditContext,
	intent: IntentOf<'setResourceAttr'>,
): IntentPlan {
	const sym = resourceOf(ctx, intent.resource);
	if (isRefused(sym)) return sym;
	const { attr, value } = intent;
	const hidden = checkBodyMacros(ctx.ws, ctx.index, sym, [attr]);
	if (hidden) return hidden;
	if (attr === 'managers') return planManagers(ctx, sym, value);
	const own = ownSites(ctx.index, sym.attrs, attr);
	const last = own[own.length - 1];
	const v = parsed(attr, value, [last?.value ?? sym.decl.header]);
	if (isRefused(v)) return v;
	if (!last) {
		const p = printValue(v);
		return p.ok
			? insertValue(ctx, sym, attr, p.value)
			: refused('invalid-value', [sym.decl.header]);
	}
	const written = macroWritten([last]);
	if (written) return written;
	if (!last.value) return refused('unsupported-form', [last.statement]);
	const file = fileOf(ctx, last.value);
	if (isRefused(file)) return file;
	const op = replaceValue(file, last.value, v);
	return 'status' in op ? op : [op];
}

const ORDER: readonly ResourceAttr[] = ['email', 'managers', 'efficiency', 'rate'];

/**
 * The body statements of a new resource `id` (addResource `attrs`), in 7.2 order, each value
 * checked as `setResourceAttr` checks it; managers written for the file `path`.
 */
export function attrStatements(
	ctx: EditContext,
	id: string,
	attrs: ReadonlyArray<readonly [ResourceAttr, AttrValue]>,
	path: string,
	at: readonly SourceRange[],
): string[] | Refused {
	const sorted = [...attrs].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
	const out: string[] = [];
	for (const [attr, value] of sorted) {
		if (attr === 'managers') {
			if (typeof value === 'boolean') return refused('invalid-value', at);
			const ids = [...new Set(typeof value === 'string' ? [value] : value)];
			if (ids.length === 0 || ids.includes(id)) return refused('invalid-value', at);
			for (const m of ids) {
				const r = ctx.index.resources.get(m);
				if (!isId(m) || !r || r.children.length > 0) return refused('invalid-value', at);
			}
			const text = writtenIds(ctx, ids, { file: path, from: 0, to: 0 });
			if (isRefused(text)) return text;
			out.push(`managers ${text.join(', ')}`);
			continue;
		}
		const v = parsed(attr, value, at);
		if (isRefused(v)) return v;
		const p = printValue(v);
		if (!p.ok) return refused('invalid-value', at);
		out.push(`${attr} ${p.value}`);
	}
	return out;
}

export function planRemoveResourceAttr(
	ctx: EditContext,
	intent: IntentOf<'removeResourceAttr'>,
): IntentPlan {
	const sym = resourceOf(ctx, intent.resource);
	if (isRefused(sym)) return sym;
	const { attr } = intent;
	const hidden = checkBodyMacros(ctx.ws, ctx.index, sym, [attr]);
	if (hidden) return hidden;
	const own = ownSites(ctx.index, sym.attrs, attr);
	const written = macroWritten(own);
	if (written) return written;
	if (own.length > 0) return removeSites(ctx, own);
	const up = INHERITED.has(attr) ? inheritedSites(ctx, sym, attr, attr === 'managers') : [];
	return up.length > 0 ? refused('inherited', ranges(up)) : noop('not-present');
}

export const RESOURCE_ATTR_HANDLERS: {
	readonly setResourceAttr: IntentHandler<'setResourceAttr'>;
	readonly removeResourceAttr: IntentHandler<'removeResourceAttr'>;
} = {
	setResourceAttr: { plan: planSetResourceAttr, sameInEveryVisit: (i) => i.attr !== 'managers' },
	removeResourceAttr: {
		plan: planRemoveResourceAttr,
		sameInEveryVisit: (i) => i.attr !== 'managers',
	},
};

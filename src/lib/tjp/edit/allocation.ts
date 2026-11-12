// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Allocation intents (phase-1.md 7.1 `allocate`, `addAllocation`, `removeAllocation`,
 * `replaceAllocation`) over the task's own plain lists: its unprefixed (or top-scenario)
 * `allocate` statements in the declaration and supplement bodies. Scenario-prefixed lists are
 * left alone.
 *
 * - The allocated set is the own lists plus what the task inherited from its parent when it was
 *   declared (TaskJuggler copies `allocate` to children, dep-graph.ts `taskState`). Removing an
 *   inherited resource is refused (`inherited`); adding one already there is noop `already-set`;
 *   removing one that is not there is noop `not-present`.
 * - Items with a body (`allocate a { alternative b select order }`) are v1: any intent on a task
 *   whose own plain lists hold one is refused (`unsupported-form`).
 * - New ids are appended to the last list that keeps an item (`, id`), else they replace the
 *   items of the last list; with no list, `allocate id` is inserted by 7.2 order, before any
 *   child task (TaskJuggler's `checkContainer`, lists.ts). Removed items take one comma; a list
 *   left empty goes with its line. `replaceAllocation` rewrites the id token in place (or drops
 *   the item when the new resource is already allocated).
 * - Resource references: TaskJuggler reads a plain id and prepends the file's `resourceprefix`
 *   (rule_resourceId), and needs the resource declared before the allocation in reading order;
 *   a resource missing, declared later, or not writable under the prefix is refused
 *   (`unknown-target`; `unsupported-form` for the prefix).
 * - Scheduling: leaving an effort leaf without allocations (effort_no_allocations: the task
 *   itself, or for a container a leaf declared after the removed item, which inherited it) and
 *   allocating to a task TaskJuggler would otherwise make a milestone, without both a start and
 *   an end, are refused (`conflicting-attribute`).
 *
 * All four change list items, so they are refused in shared files (15.16).
 */
import { compareParseOrder } from '../../workspace/include-order';
import type { AllocationSite, AttrSite, ResourceId, SourceRange, TaskSymbol } from '../index';
import { isId } from '../values';
import type { IntentHandlers } from './apply';
import { isMilestone, stateReader, taskState, topScenario } from './dep-graph';
import { rangeKey, unprefixed } from './deps-links';
import { replaceSpan } from './layout';
import { appendOrInsert, checkBodyMacros, itemSpans, removeItems } from './lists';
import { subtree } from './refs';
import {
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type Refused,
} from './types';

interface Own {
	readonly task: TaskSymbol;
	/** Own plain `allocate` statements in reading order. */
	readonly sites: readonly AttrSite[];
	readonly items: readonly AllocationSite[];
	/** Resources inherited from the parent (top scenario). */
	readonly inherited: ReadonlySet<string>;
}

function ownLists(ctx: EditContext, id: string): Own | Refused {
	const { index } = ctx;
	const task = index.tasks.get(id);
	if (!task) return refused('unknown-target');
	if (task.expandedOnly)
		return refused('text-only', [task.decl.block], { textOnly: 'expanded-only' });
	const hidden = checkBodyMacros(ctx.ws, index, task, ['allocate']);
	if (hidden) return hidden;
	const sites = task.attrs.filter((a) => a.keyword === 'allocate' && unprefixed(index, a.scenario));
	const keys = new Set(sites.map((s) => rangeKey(s.statement)));
	const seen = new Set<string>();
	const items = index.allocations.filter((a) => {
		if (a.task !== id || !keys.has(rangeKey(a.statement)) || seen.has(rangeKey(a.item)))
			return false;
		seen.add(rangeKey(a.item));
		return true;
	});
	const bodied = items.filter((a) => a.body !== null);
	const at = bodied.map((a) => a.item);
	if (at.length > 0) return refused('unsupported-form', at);
	const inh = taskState(ctx.ws, index, id, topScenario(index)).inherited;
	const inherited = new Set((inh?.allocs ?? []).filter((r): r is string => r !== null));
	return { task, sites, items, inherited };
}

/** How `resource` is written in `file`, or a refusal (module comment). */
function resourceText(ctx: EditContext, resource: ResourceId, file: string): string | Refused {
	const res = ctx.index.resources.get(resource);
	if (!res) return refused('unknown-target');
	const visit = ctx.index.visits.find((v) => v.file === file);
	const prefix = visit?.resourcePrefix ?? { kind: 'none' };
	if (prefix.kind === 'unknown') return refused('unsupported-form', [res.decl.header]);
	let text = resource;
	if (prefix.kind === 'id') {
		if (!resource.startsWith(`${prefix.id}.`))
			return refused('unsupported-form', [res.decl.header]);
		text = resource.slice(prefix.id.length + 1);
	}
	return isId(text) ? text : refused('unsupported-form', [res.decl.header]);
}

/** `unknown-target` unless the resource is declared before `at` in reading order. */
function declaredBefore(
	ctx: EditContext,
	resource: ResourceId,
	at: { file: string; from: number },
): Refused | null {
	const res = ctx.index.resources.get(resource);
	if (!res) return refused('unknown-target');
	const d = { file: res.decl.block.file, from: res.decl.block.from };
	return compareParseOrder(ctx.ws.includes, d, at, 'first') < 0
		? null
		: refused('unknown-target', [res.decl.header]);
}

/** Removes the given own items, grouped by statement. */
function removeOwn(ctx: EditContext, gone: readonly AllocationSite[]): EditOp[] | Refused {
	const by = new Map<string, { statement: SourceRange; items: SourceRange[] }>();
	for (const a of gone) {
		const g = by.get(rangeKey(a.statement)) ?? { statement: a.statement, items: [] };
		g.items.push(a.item);
		by.set(rangeKey(a.statement), g);
	}
	const ops: EditOp[] = [];
	for (const { statement, items } of by.values()) {
		const file = ctx.ws.files.get(statement.file);
		if (!file) return refused('unknown-target', [statement]);
		const r = removeItems(file, statement, items);
		if ('status' in r) return r;
		ops.push(...r);
	}
	return ops;
}

/**
 * effort_no_allocations (module comment, "Scheduling"): the effort leaves of the subtree that
 * have allocations now and none after the edit. A removed item reaches the task itself and the
 * descendants declared after its statement (they inherited it); new ids, those declared after
 * `addAt`. Bookings do not count: TaskScenario#preScheduleCheck needs an allocation for any
 * effort.
 */
function effortLeft(
	ctx: EditContext,
	own: Own,
	remove: readonly AllocationSite[],
	addAt: { file: string; from: number } | null,
): Refused | null {
	const { ws, index } = ctx;
	const read = stateReader(ws, index);
	const at: SourceRange[] = [];
	for (const id of subtree(index, 'task', own.task.id)) {
		const sym = index.tasks.get(id);
		if (!sym || sym.children.length > 0) continue;
		const effort = sym.attrs.filter((a) => a.keyword === 'effort');
		if (effort.length === 0) continue;
		const decl = { file: sym.decl.block.file, from: sym.decl.block.from };
		const reaches = (r: { file: string; from: number }): boolean =>
			id === own.task.id || compareParseOrder(ws.includes, r, decl, 'first') < 0;
		if (addAt && reaches(addAt)) continue;
		const allocs = [...read(id).state.allocs];
		if (allocs.length === 0) continue;
		for (const a of remove) {
			const i = reaches(a.statement) ? allocs.indexOf(a.resource) : -1;
			if (i >= 0) allocs.splice(i, 1);
		}
		if (allocs.length === 0) at.push(...effort.map((a) => a.statement));
	}
	return at.length > 0 ? refused('conflicting-attribute', at) : null;
}

/**
 * task_underspecified (module comment, "Scheduling"): a container's new allocation reaches the
 * children declared after it, so every leaf of the subtree that would stop being an implicit
 * milestone needs both ends.
 */
function milestoneLost(ctx: EditContext, own: Own): Refused | null {
	const { ws, index } = ctx;
	const read = stateReader(ws, index);
	for (const id of subtree(index, 'task', own.task.id)) {
		const sym = index.tasks.get(id);
		if (!sym || sym.children.length > 0) continue;
		const st = read(id).state;
		if (st.allocs.length > 0 || st.milestone || !isMilestone(st, false)) continue;
		const hasStart = st.start || st.depends.length > 0;
		const hasEnd = st.end || st.precedes.length > 0;
		if (!(hasStart && hasEnd)) return refused('conflicting-attribute', [sym.decl.header]);
	}
	return null;
}

/**
 * The edit that leaves the own lists without `remove` and with `add` (ids not yet allocated),
 * placing new ids by the module comment.
 */
function reshape(
	ctx: EditContext,
	own: Own,
	remove: readonly AllocationSite[],
	add: readonly ResourceId[],
): IntentPlan {
	const gone = new Set(remove.map((a) => rangeKey(a.item)));
	const kept = own.items.filter((a) => !gone.has(rangeKey(a.item)));
	if (add.length === 0) {
		if (remove.length === 0) return noop('already-set');
		return effortLeft(ctx, own, remove, null) ?? removeOwn(ctx, remove);
	}
	const lost = milestoneLost(ctx, own);
	if (lost) return lost;
	const survivor = [...own.sites]
		.reverse()
		.find((s) => kept.some((a) => rangeKey(a.statement) === rangeKey(s.statement)));
	const target = survivor ?? own.sites[own.sites.length - 1] ?? null;
	const file = ctx.ws.files.get(target?.statement.file ?? own.task.decl.block.file);
	if (!file) return refused('unknown-target');
	const texts: string[] = [];
	for (const r of add) {
		const t = resourceText(ctx, r, file.path);
		if (typeof t !== 'string') return t;
		texts.push(t);
	}
	if (target && !survivor) {
		// Every list loses all its items: the last one takes the new ids in place of its items.
		const items = itemSpans(file, target.statement);
		const first = items?.[0];
		const last = items?.[items.length - 1];
		if (!first || !last) return refused('unknown-target', [target.statement]);
		for (const r of add) {
			const d = declaredBefore(ctx, r, target.statement);
			if (d) return d;
		}
		const left = effortLeft(ctx, own, remove, target.statement);
		if (left) return left;
		const others = remove.filter((a) => rangeKey(a.statement) !== rangeKey(target.statement));
		const rest = removeOwn(ctx, others);
		if ('status' in rest) return rest;
		return [replaceSpan(file, { from: first.from, to: last.to }, texts.join(', ')), ...rest];
	}
	const removal = removeOwn(ctx, remove);
	if ('status' in removal) return removal;
	const r = appendOrInsert(
		(p) => ctx.ws.files.get(p),
		target?.statement ?? null,
		own.task.decl.block,
		'allocate',
		texts.join(', '),
	);
	if ('status' in r) return r;
	for (const id of add) {
		const d = declaredBefore(ctx, id, r.at);
		if (d) return d;
	}
	const left = effortLeft(ctx, own, remove, r.at);
	if (left) return left;
	return [...removal, ...r.ops];
}

const allocated = (own: Own, r: string): boolean =>
	own.inherited.has(r) || own.items.some((a) => a.resource === r);

function inheritedRefusal(own: Own): Refused {
	return refused('inherited', [own.task.decl.header]);
}

export function allocatePlan(ctx: EditContext, intent: IntentOf<'allocate'>): IntentPlan {
	const own = ownLists(ctx, intent.task);
	if ('status' in own) return own;
	const wanted = new Set(intent.resources);
	for (const r of wanted) if (!ctx.index.resources.has(r)) return refused('unknown-target');
	for (const r of own.inherited) if (!wanted.has(r)) return inheritedRefusal(own);
	const remove = own.items.filter((a) => a.resource !== null && !wanted.has(a.resource));
	const add = [...wanted].filter((r) => !allocated(own, r));
	return reshape(ctx, own, remove, add);
}

export function addAllocationPlan(ctx: EditContext, intent: IntentOf<'addAllocation'>): IntentPlan {
	const own = ownLists(ctx, intent.task);
	if ('status' in own) return own;
	if (!ctx.index.resources.has(intent.resource)) return refused('unknown-target');
	if (allocated(own, intent.resource)) return noop('already-set');
	return reshape(ctx, own, [], [intent.resource]);
}

export function removeAllocationPlan(
	ctx: EditContext,
	intent: IntentOf<'removeAllocation'>,
): IntentPlan {
	const own = ownLists(ctx, intent.task);
	if ('status' in own) return own;
	if (own.inherited.has(intent.resource)) return inheritedRefusal(own);
	const remove = own.items.filter((a) => a.resource === intent.resource);
	if (remove.length === 0) return noop('not-present');
	return reshape(ctx, own, remove, []);
}

export function replaceAllocationPlan(
	ctx: EditContext,
	intent: IntentOf<'replaceAllocation'>,
): IntentPlan {
	const own = ownLists(ctx, intent.task);
	if ('status' in own) return own;
	if (!ctx.index.resources.has(intent.to)) return refused('unknown-target');
	if (intent.from === intent.to) return noop('already-set');
	if (own.inherited.has(intent.from)) return inheritedRefusal(own);
	const items = own.items.filter((a) => a.resource === intent.from);
	if (items.length === 0) return noop('not-present');
	if (allocated(own, intent.to)) return reshape(ctx, own, items, []);
	const ops: EditOp[] = [];
	for (const a of items) {
		const file = ctx.ws.files.get(a.ref.file);
		if (!file) return refused('unknown-target', [a.ref]);
		const text = resourceText(ctx, intent.to, file.path);
		if (typeof text !== 'string') return text;
		const d = declaredBefore(ctx, intent.to, a.statement);
		if (d) return d;
		ops.push(replaceSpan(file, a.ref, text));
	}
	return ops;
}

export const ALLOCATION_HANDLERS: IntentHandlers = {
	allocate: { plan: allocatePlan },
	addAllocation: { plan: addAllocationPlan },
	removeAllocation: { plan: removeAllocationPlan },
	replaceAllocation: { plan: replaceAllocationPlan },
};

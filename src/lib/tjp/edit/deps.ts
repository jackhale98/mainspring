// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Dependency intents (phase-1.md 7.1 `addDepends`, `removeDepends`; `setDependsGap` is in
 * deps-gap.ts, the link helpers in deps-links.ts). `task` is the successor, `target` the
 * predecessor.
 *
 * addDepends:
 * - refuses `unknown-target` (either task missing), `text-only` (a task declared only through
 *   macro expansion), and `cycle` for a dependency on the task itself, on an ancestor or on a
 *   descendant (TaskJuggler's task_depend_self/parent/child) or one that makes TaskJuggler's loop
 *   check fail in some scenario, or a cycle of start and end times that check misses and
 *   TaskJuggler cannot handle (its `calcPathCriticalness` overflows the stack before scheduling;
 *   dep-graph.ts, dep-loops.ts), unnamed declarations included;
 * - noop `already-linked` when an unprefixed (or top-scenario) item already links the two: the
 *   successor's `depends`, the predecessor's `precedes`, or such a list inherited from a parent
 *   (a second `depends` on the same task is task_depend_multi natively);
 * - refuses `conflicting-attribute` when only a scenario-prefixed `depends` names the
 *   predecessor (an unprefixed one would apply to that scenario too, twice), or when a child
 *   declared after the new item already depends on the predecessor (it inherits the item), or
 *   when the new item would override the successor's own `scheduling alap` (no own ASAP setting
 *   after it, and no own direction setting after the new item; dep-graph.ts `ownAlapBefore`,
 *   `at` that statement): rule_depends sets `forward` and TaskJuggler drops the clash silently,
 *   so the task would turn ASAP against what it says (a container's later children inherit ASAP
 *   too). An ALAP inherited from a parent, or set only by `end` or `precedes`, is overridden as
 *   TaskJuggler documents for `depends`;
 * - refuses `conflicting-attribute` when the item would make a sized leaf with a fixed `end` ASAP
 *   (task_overspecified): the successor, or, for a container, a leaf declared after the item
 *   that inherits it and the direction;
 * - appends `, ref` to the successor's last own unprefixed `depends`, else inserts
 *   `depends ref` by 7.2 order (before any child task, lists.ts). `ref` is `!id` for a sibling,
 *   else the absolute id (refs.ts `taskRefText`, ADR-0003 #7).
 *
 * removeDepends removes the link without a scenario: every item that links the two, the
 * successor's `depends` items naming the predecessor and the predecessor's `precedes` items
 * naming the successor, each with its `{ … }` body and one comma, or the statement when it was
 * the only item. Scenario-prefixed items go too when an unprefixed (or top-scenario) one exists;
 * when only prefixed items link the two, the link exists only in those scenarios and the intent
 * refuses `conflicting-attribute` (`at` those items), as addDepends does for the same link,
 * rather than noop `not-present`, which would read as no link at all. Noop `not-present`;
 * `inherited` when the link only comes from a parent's list.
 *
 * Both change list items, so they are refused in shared files (15.16, `sameInEveryVisit` false).
 */
import { compareParseOrder } from '../../workspace/include-order';
import { lastSite, type SourceRange, type TaskId } from '../index';
import type { IntentHandlers } from './apply';
import { newLoop, ownAlapBefore, stateReader, type ExtraDep, type TaskState } from './dep-graph';
import { orphanDeps } from './dep-orphans';
import { setDependsGapPlan } from './deps-gap';
import {
	inheritedItems,
	inheritedLink,
	isAncestor,
	linkItems,
	linkTasks,
	rangeKey,
	unprefixed,
} from './deps-links';
import { appendOrInsert, removeItems } from './lists';
import { subtree, taskRefText } from './refs';
import { checkAnchors } from './task-semantics';
import { afterEdit } from './task-verify';
import {
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type Refused,
} from './types';

/**
 * `depends` items on `pred` in the descendants of `succ` declared after `at`: they would inherit
 * the new item and have it twice (task_depend_multi), named or not (dep-orphans.ts).
 */
function inheritedTwice(
	ctx: EditContext,
	succ: TaskId,
	pred: TaskId,
	at: { file: string; from: number },
): SourceRange[] {
	const { index, ws } = ctx;
	const after = (r: SourceRange): boolean => compareParseOrder(ws.includes, at, r, 'first') < 0;
	const out: SourceRange[] = [];
	for (const id of subtree(index, 'task', succ).slice(1)) {
		const sym = index.tasks.get(id);
		if (!sym || !after(sym.decl.block)) continue;
		for (const d of linkItems(index, id, pred)) if (d.form === 'depends') out.push(d.item);
	}
	for (const o of orphanDeps(ws, index)) {
		if (o.form !== 'depends' || o.target !== pred || o.within === null) continue;
		const below = o.within === succ || isAncestor(index, succ, o.within);
		if (below && after(o.site.statement)) out.push(o.site.item);
	}
	return out;
}

export function addDependsPlan(ctx: EditContext, intent: IntentOf<'addDepends'>): IntentPlan {
	const { index, ws } = ctx;
	const tasks = linkTasks(ctx, intent.task, intent.target);
	if ('status' in tasks) return tasks;
	const { succ, pred } = tasks;
	const ends = [succ.decl.header, pred.decl.header];
	const related =
		succ.id === pred.id ||
		isAncestor(index, succ.id, pred.id) ||
		isAncestor(index, pred.id, succ.id);
	if (related) return refused('cycle', ends);
	const items = linkItems(index, succ.id, pred.id);
	if (items.some((d) => unprefixed(index, d.scenario))) return noop('already-linked');
	if (inheritedLink(ctx, succ.id, pred.id)) return noop('already-linked');
	const clash = items.filter((d) => d.form === 'depends');
	if (clash.length > 0) {
		const at = clash.map((d) => d.item);
		return refused('conflicting-attribute', at);
	}
	const last = lastSite(succ.attrs, 'depends', null, index.scenarios[0]?.id ?? null);
	const ref = taskRefText(succ.id, pred.id);
	const r = appendOrInsert(
		(p) => ws.files.get(p),
		last?.statement ?? null,
		succ.decl.block,
		'depends',
		ref,
	);
	if ('status' in r) return r;
	const twice = inheritedTwice(ctx, succ.id, pred.id, r.at);
	if (twice.length > 0) return refused('conflicting-attribute', twice);
	const alap = ownAlapBefore(ws, index, succ.id, r.at);
	if (alap) return refused('conflicting-attribute', [alap.statement]);
	const extra = [
		{ owner: succ.id, form: 'depends', target: pred.id, onEnd: true, at: r.at },
	] as const;
	const over = overspecified(ctx, succ.id, extra);
	if (over) return over;
	if (newLoop(ws, index, extra) !== null) return refused('cycle', ends);
	return anchored(ctx, r.ops, [succ.id, pred.id], ends) ?? r.ops;
}

/**
 * `conflicting-attribute` when the edit leaves a task of the two subtrees unanchored (15.24,
 * dep-anchors.ts `isUnanchored`): a new `depends` names an ALAP task that has no `end` or
 * `precedes`, or a removed item was the only anchor of a task another item names.
 */
function anchored(
	ctx: EditContext,
	ops: readonly EditOp[],
	roots: readonly TaskId[],
	at: readonly SourceRange[],
): Refused | null {
	const same = (id: TaskId): TaskId => id;
	const ids = [...new Set(roots.flatMap((r) => subtree(ctx.index, 'task', r)))];
	const pairs = ids.map((id): readonly [TaskId, TaskId] => [id, id]);
	return checkAnchors(ctx, afterEdit(ctx, ops, same), pairs, at);
}

/**
 * `conflicting-attribute` when the new item makes a sized leaf with a fixed `end` scheduled
 * ASAP with a dependency: TaskJuggler's task_overspecified (TaskScenario.rb:371-380; `depends`
 * sets the task ASAP). The leaves are the task, or the leaves of its subtree, which inherit the
 * item and the direction when declared after it; only leaves the item makes overspecified
 * count. Checked in every scenario.
 */
function overspecified(ctx: EditContext, task: TaskId, extra: readonly ExtraDep[]): Refused | null {
	const { ws, index } = ctx;
	const over = (st: TaskState): boolean =>
		st.sizing && !st.milestone && st.end && st.forward && st.depends.length > 0;
	const scenarios = index.scenarios.length > 0 ? index.scenarios.map((s) => s.id) : ['plan'];
	for (const sc of scenarios) {
		const before = stateReader(ws, index, sc);
		const after = stateReader(ws, index, sc, extra);
		for (const id of subtree(index, 'task', task)) {
			const sym = index.tasks.get(id);
			if (!sym || sym.children.length > 0 || sym.attrs.some((a) => a.keyword === 'scheduled')) {
				continue;
			}
			if (!over(after(id).state) || over(before(id).state)) continue;
			const at = sym.attrs.filter((a) => a.keyword === 'end').map((a) => a.statement);
			return refused('conflicting-attribute', at.length > 0 ? at : [sym.decl.header]);
		}
	}
	return null;
}

export function removeDependsPlan(ctx: EditContext, intent: IntentOf<'removeDepends'>): IntentPlan {
	const { index, ws } = ctx;
	const tasks = linkTasks(ctx, intent.task, intent.target);
	if ('status' in tasks) return tasks;
	const { succ, pred } = tasks;
	const items = linkItems(index, succ.id, pred.id);
	if (!items.some((d) => unprefixed(index, d.scenario))) {
		if (inheritedLink(ctx, succ.id, pred.id))
			return refused('inherited', inheritedItems(index, succ.id, pred.id));
		if (items.length > 0)
			return refused(
				'conflicting-attribute',
				items.map((d) => d.item),
			);
		return noop('not-present');
	}
	const byStatement = new Map<string, { statement: SourceRange; gone: SourceRange[] }>();
	for (const d of items) {
		const k = rangeKey(d.statement);
		const g = byStatement.get(k) ?? { statement: d.statement, gone: [] };
		g.gone.push(d.item);
		byStatement.set(k, g);
	}
	const ops: EditOp[] = [];
	for (const { statement, gone } of byStatement.values()) {
		const file = ws.files.get(statement.file);
		if (!file) return refused('unknown-target', [statement]);
		const r = removeItems(file, statement, gone);
		if ('status' in r) return r;
		ops.push(...r);
	}
	return anchored(ctx, ops, [succ.id, pred.id], [succ.decl.header, pred.decl.header]) ?? ops;
}

export const DEPENDENCY_HANDLERS: IntentHandlers = {
	addDepends: { plan: addDependsPlan },
	removeDepends: { plan: removeDependsPlan },
	setDependsGap: { plan: setDependsGapPlan },
};

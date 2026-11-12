// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Scheduling anchors of a task, as the edit intents read them to refuse engine errors the text
 * decides (15.24; shared by the task attribute, dependency, allocation and task tree intents).
 * Each predicate reads a task's state from dep-graph.ts (`TaskState`: direction, own `start` and
 * `end`, own and inherited dependencies and allocations) and what other tasks' dependency items
 * say about it, in every scenario and also for items of declarations the index cannot name.
 * Both were worked out against native tj3 3.8.4:
 *
 * - `isUnderspecified`: an allocated or booked leaf without size needs its open end left alone
 *   (`task_underspecified`, "has not been marked as scheduled");
 * - `isUnanchored`: an ASAP task that a `precedes` names needs its own `start` or a `depends`, an
 *   ALAP task that a `depends` names needs its own `end` or a `precedes`, else the chain waits on
 *   itself (`not_scheduled`).
 */
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { SymbolIndex, TaskId } from '../index';
import type { TaskState } from './dep-graph';
import { depOnEnd, orphanDeps, type OrphanDep } from './dep-orphans';

/**
 * What depends on a task or one of its ancestors, as `isUnderspecified` reads it (all scenarios,
 * also items of declarations the index cannot name): `end` when a `depends` item names one of them
 * that targets an end (not `{ onstart }`; a successor waits for the end), `start` when a
 * `precedes` item that targets a start (not `{ onend }`) names one of them (a predecessor fixes the
 * start).
 */
export interface Dependents {
	readonly end: boolean;
	readonly start: boolean;
}

const orphanCache = new WeakMap<SymbolIndex, OrphanDep[]>();

/** `orphanDeps` once per index (the semantic checks ask for many tasks of one snapshot). */
function orphansOf(ws: WorkspaceSnapshot, index: SymbolIndex): OrphanDep[] {
	let o = orphanCache.get(index);
	if (!o) {
		o = orphanDeps(ws, index);
		orphanCache.set(index, o);
	}
	return o;
}

/** The dependents of `task` and its ancestors in `index` (module comment of `Dependents`). */
export function dependentsOf(ws: WorkspaceSnapshot, index: SymbolIndex, task: TaskId): Dependents {
	const chain = new Set<TaskId>();
	for (let x: TaskId | null = task; x !== null; x = index.tasks.get(x)?.parent ?? null)
		chain.add(x);
	let end = false;
	let start = false;
	for (const d of index.dependencies) {
		if (d.form === 'depends' && d.pred !== null && chain.has(d.pred) && depOnEnd(ws, d)) {
			end = true;
		}
		if (d.form === 'precedes' && d.succ !== null && chain.has(d.succ) && !depOnEnd(ws, d)) {
			start = true;
		}
		if (end && start) return { end, start };
	}
	// Items of declarations the index cannot name (`task "Item 2" { depends !!wp2 }`).
	for (const o of orphansOf(ws, index)) {
		if (!chain.has(o.target)) continue;
		if (o.form === 'depends') end ||= o.onEnd;
		else if (!o.onEnd) start = true;
	}
	return { end, start };
}

/**
 * `task_underspecified` (TaskScenario.rb:345) and "has not been marked as scheduled" for a leaf
 * with no sizing criterion or `milestone` and an allocation (own or inherited) or a booking, which
 * keeps it from being promoted to a milestone (`markAsMilestone`, :2288). `start` and `end` are
 * not inherited (Project.rb:273, :327); dependencies are. Checked in native tj3 3.8.4:
 *
 * - with a start (own `start` or a `depends`) and an end (own `end` or a `precedes`) it schedules;
 * - with neither it fails;
 * - with only a start it runs from there to the project end, and fails when a `depends` names it
 *   or an ancestor without `{ onstart }` (`dependents.end`); a `precedes` on it, also
 *   `{ onend }`, and a `depends … { onstart }` do not matter;
 * - with only an end it runs from the project start, and fails when a `precedes` that targets a
 *   start names it or an ancestor (`dependents.start`); a `depends` on it, also `{ onstart }`,
 *   does not matter.
 */
export function isUnderspecified(st: TaskState, dependents: Dependents): boolean {
	if (st.sizing || st.milestone) return false;
	if (st.allocs.length === 0 && !st.booking) return false;
	const hasStart = st.start || st.depends.length > 0;
	const hasEnd = st.end || st.precedes.length > 0;
	if (hasStart && hasEnd) return false;
	if (!hasStart && !hasEnd) return true;
	return hasStart ? dependents.end : dependents.start;
}

/** What other tasks' dependency items name a task itself with (all scenarios, orphans too). */
export interface NamedBy {
	/** A `precedes` item names it (either end). */
	readonly precedes: boolean;
	/** A `depends` item names it (either end). */
	readonly depends: boolean;
}

export function namedBy(ws: WorkspaceSnapshot, index: SymbolIndex, task: TaskId): NamedBy {
	let precedes = false;
	let depends = false;
	for (const d of index.dependencies) {
		if (d.form === 'precedes' && d.succ === task) precedes = true;
		if (d.form === 'depends' && d.pred === task) depends = true;
	}
	for (const o of orphansOf(ws, index)) {
		if (o.target !== task) continue;
		if (o.form === 'precedes') precedes = true;
		else depends = true;
	}
	return { precedes, depends };
}

/** The parts of a task's state the anchor rule reads (TaskState or T11a's timing state). */
export interface Anchors {
	readonly forward: boolean;
	readonly start: boolean;
	readonly end: boolean;
	readonly depends: boolean;
	readonly precedes: boolean;
}

export const anchorsOf = (st: TaskState): Anchors => ({
	forward: st.forward,
	start: st.start,
	end: st.end,
	depends: st.depends.length > 0,
	precedes: st.precedes.length > 0,
});

/**
 * Whether a task (leaf or container) cannot be scheduled because a dependency chain waits on the
 * side it would compute from (native `not_scheduled`, checked in tj3 3.8.4):
 *
 * - ASAP (direction as `TaskState.forward`: positional, inherited at creation): a `precedes` that
 *   names it, also `{ onend }`, makes it wait for a start it can only get from its own `start` or a
 *   `depends` (own or inherited); a parent's `start` or `scheduling asap` does not help;
 * - ALAP: mirrored, a `depends` that names it, also `{ onstart }`, needs its own `end` or a
 *   `precedes` (own or inherited).
 */
export function isUnanchored(st: Anchors, named: NamedBy): boolean {
	if (st.forward) return named.precedes && !st.start && !st.depends;
	return named.depends && !st.end && !st.precedes;
}

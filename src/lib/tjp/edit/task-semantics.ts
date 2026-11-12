// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Engine errors of the task tree intents that the text already decides (as 15.19 and 15.20 refuse
 * them for the dependency and attribute intents). Each is refused only when the edit introduces
 * it:
 *
 * - `conflicting-attribute` for a child added or moved under a task that has its own sizing
 *   criterion, `milestone` or bookings and no children yet (a container may not have them:
 *   TaskScenario.rb `container_duration`, `container_milestone`, `container_booking`), at those
 *   statements;
 * - `conflicting-attribute` when a task in the moved or added subtree has `effort` and loses every
 *   allocation it had (an inherited `allocate` from its old ancestors), or a new task with
 *   `effort` gets none (`effort_no_allocations`), at the `effort` statement;
 * - `conflicting-attribute` when a leaf becomes underspecified (`task_underspecified`, dep-graph.ts
 *   `isUnderspecified`: allocated or booked, no size, not both a start and an end), or an
 *   underspecified leaf loses the start or end it had: a new or moved leaf, an old parent left
 *   without children (by a move or a delete), or a task that loses a dependency to a delete;
 * - `cycle` when the edited graph has a dependency loop or time-point cycle in a scenario that the
 *   old one did not (dep-graph.ts `graphLoops`; dependencies are inherited from the new parent).
 *
 * The task's state in each snapshot is dep-graph.ts `stateReader`'s (direction, inherited
 * dependencies and allocations).
 */
import type { SourceRange, SymbolIndex, TaskId, TaskSymbol } from '../index';
import { graphLoops, isUnderspecified, stateReader } from './dep-graph';
import { SIZING, bookingsOf, isContainer } from './task-attrs-checks';
import type { Edited } from './task-verify';
import { refused, type EditContext, type Refused } from './types';

/** The loops of the edit's own index, computed once per index (a UI makes many edits on one). */
const loopsOf = new WeakMap<SymbolIndex, ReturnType<typeof graphLoops>>();

function beforeLoops(ctx: EditContext): ReturnType<typeof graphLoops> {
	let l = loopsOf.get(ctx.index);
	if (!l) {
		l = graphLoops(ctx.ws, ctx.index);
		loopsOf.set(ctx.index, l);
	}
	return l;
}

/**
 * `conflicting-attribute` when `parent` is a leaf with its own sizing, `milestone` or bookings.
 */
export function checkNewParent(ctx: EditContext, parent: TaskSymbol | null): Refused | null {
	if (!parent || isContainer(ctx, parent)) return null;
	const sites = parent.attrs
		.filter((a) => SIZING.has(a.keyword) || a.keyword === 'milestone')
		.map((a) => a.statement);
	const at = [...sites, ...bookingsOf(ctx, parent)];
	return at.length > 0 ? refused('conflicting-attribute', at) : null;
}

export interface EditedTasks {
	/** Old ids of the moved subtree (mapped by `map`). */
	readonly moved?: readonly TaskId[];
	/** A new task's id. */
	readonly added?: TaskId | null;
	/** Other old ids whose state the edit may change (an old parent, dependency owners). */
	readonly touched?: readonly TaskId[];
	readonly map: (id: TaskId) => TaskId | null;
	/** Where to refuse what has no range of its own in the old text. */
	readonly at: readonly SourceRange[];
}

/** The checks of the module comment after the edit. */
export function checkEdited(ctx: EditContext, edited: Edited, t: EditedTasks): Refused | null {
	const moved = t.moved ?? [];
	const added = t.added ?? null;
	const before = beforeLoops(ctx);
	for (const [sc, now] of graphLoops(edited.snap, edited.index)) {
		const was = before.get(sc);
		if ((now.loop && !was?.loop) || (now.cycle && !was?.cycle)) return refused('cycle', t.at);
	}
	const old = stateReader(ctx.ws, ctx.index);
	const next = stateReader(edited.snap, edited.index);
	const effortOf = (sym: TaskSymbol | undefined): SourceRange | null =>
		sym?.attrs.find((a) => a.keyword === 'effort')?.statement ?? null;
	for (const id of moved) {
		const effort = effortOf(ctx.index.tasks.get(id));
		const mapped = t.map(id);
		if (!effort || mapped === null || !edited.index.tasks.has(mapped)) continue;
		const had = old(id).state.allocs.length > 0;
		if (had && next(mapped).state.allocs.length === 0) {
			return refused('conflicting-attribute', [effort]);
		}
	}
	if (added !== null) {
		const sym = edited.index.tasks.get(added);
		if (effortOf(sym) && next(added).state.allocs.length === 0) {
			return refused('conflicting-attribute', t.at);
		}
	}
	const after: EditContext = { ws: edited.snap, index: edited.index, opts: ctx.opts };
	/** -1 when the leaf is not at risk, else how many of its two ends are specified. */
	const risk = (c: EditContext, read: typeof next, id: TaskId): number => {
		const sym = c.index.tasks.get(id);
		if (!sym || isContainer(c, sym)) return -1;
		const st = read(id).state;
		if (!isUnderspecified(st)) return -1;
		return Number(st.start || st.depends.length > 0) + Number(st.end || st.precedes.length > 0);
	};
	const candidates: Array<[TaskId | null, TaskId]> = [
		...[...moved, ...(t.touched ?? [])].map((id): [TaskId | null, TaskId | null] => [
			id,
			t.map(id),
		]),
		...(added === null ? [] : [[null, added] as [null, TaskId]]),
	].filter((c): c is [TaskId | null, TaskId] => c[1] !== null);
	for (const [was, now] of candidates) {
		const r = risk(after, next, now);
		if (r < 0) continue;
		// Introduced: the leaf was not at risk, or it loses a start or an end it had.
		const before = was === null ? -1 : risk(ctx, old, was);
		if (before >= 0 && r >= before) continue;
		const sym = was === null ? undefined : ctx.index.tasks.get(was);
		return refused('conflicting-attribute', sym ? [sym.decl.header] : t.at);
	}
	return null;
}

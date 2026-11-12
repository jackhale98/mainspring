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
 *   `isUnderspecified`: allocated or booked, no size, and neither a start nor an end, or only one
 *   of them while a dependency waits on the open one): a new or moved leaf, an old parent left
 *   without children (by a move or a delete), or the leaves of a task that loses a dependency to
 *   a delete (an inherited dependency reaches every leaf below it);
 * - `conflicting-attribute` when a task is left unanchored (dep-anchors.ts `isUnanchored`: an ASAP
 *   task a `precedes` names without its own `start` or a `depends`, or the ALAP mirror), checked
 *   for the same tasks, containers included (`checkAnchors`, also used by deps.ts);
 * - `cycle` when the edited graph has a dependency loop or time-point cycle in a scenario that the
 *   old one did not (dep-graph.ts `graphLoops`; dependencies are inherited from the new parent).
 *
 * The task's state in each snapshot is dep-graph.ts `stateReader`'s (direction, inherited
 * dependencies and allocations).
 */
import type { SourceRange, SymbolIndex, TaskId, TaskSymbol } from '../index';
import { anchorsOf, dependentsOf, isUnanchored, isUnderspecified, namedBy } from './dep-anchors';
import { graphLoops, stateReader } from './dep-graph';
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
	const under = (c: EditContext, read: typeof next, id: TaskId): boolean => {
		const sym = c.index.tasks.get(id);
		if (!sym || isContainer(c, sym)) return false;
		return isUnderspecified(read(id).state, dependentsOf(c.ws, c.index, id));
	};
	const candidates: Array<[TaskId | null, TaskId]> = [
		...[...moved, ...(t.touched ?? [])].map((id): [TaskId | null, TaskId | null] => [
			id,
			t.map(id),
		]),
		...(added === null ? [] : [[null, added] as [null, TaskId]]),
	].filter((c): c is [TaskId | null, TaskId] => c[1] !== null);
	for (const [was, now] of candidates) {
		if (!under(after, next, now)) continue;
		if (was !== null && under(ctx, old, was)) continue;
		const sym = was === null ? undefined : ctx.index.tasks.get(was);
		return refused('conflicting-attribute', sym ? [sym.decl.header] : t.at);
	}
	return checkAnchors(ctx, edited, candidates, t.at);
}

/**
 * `conflicting-attribute` when the edit leaves one of `pairs` (old id or null, new id)
 * unanchored that was not (dep-anchors.ts `isUnanchored`; leaves and containers), at its header,
 * else at `at`. Shared with the dependency intents (deps.ts).
 */
export function checkAnchors(
	ctx: EditContext,
	edited: Edited,
	pairs: ReadonlyArray<readonly [TaskId | null, TaskId]>,
	at: readonly SourceRange[],
): Refused | null {
	const old = stateReader(ctx.ws, ctx.index);
	const next = stateReader(edited.snap, edited.index);
	const loose = (ws: Edited['snap'], index: SymbolIndex, read: typeof next, id: TaskId): boolean =>
		index.tasks.has(id) && isUnanchored(anchorsOf(read(id).state), namedBy(ws, index, id));
	for (const [was, now] of pairs) {
		if (!loose(edited.snap, edited.index, next, now)) continue;
		if (was !== null && loose(ctx.ws, ctx.index, old, was)) continue;
		const sym = was === null ? undefined : ctx.index.tasks.get(was);
		return refused('conflicting-attribute', sym ? [sym.decl.header] : at);
	}
	return null;
}

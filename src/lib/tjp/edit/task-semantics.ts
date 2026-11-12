// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Engine errors of the task tree intents that the text already decides (as 15.19 and 15.20 refuse
 * them for the dependency and attribute intents). Each is refused only when the edit introduces
 * it:
 *
 * - `conflicting-attribute` for a child added or moved under a task that has its own sizing
 *   criterion or `milestone` and no children yet (a container may not have them: TaskScenario.rb
 *   `container_duration`, `container_milestone`), at those statements;
 * - `conflicting-attribute` when a task in the moved or added subtree has `effort` and loses every
 *   allocation it had (an inherited `allocate` from its old ancestors), or a new task with
 *   `effort` gets none (`effort_no_allocations`), at the `effort` statement;
 * - `cycle` when the edited graph has a dependency loop or time-point cycle in a scenario that the
 *   old one did not (dep-graph.ts `graphLoops`; dependencies are inherited from the new parent).
 *
 * The task's state in each snapshot is dep-graph.ts `stateReader`'s (direction, inherited
 * dependencies and allocations).
 */
import type { SourceRange, SymbolIndex, TaskId, TaskSymbol } from '../index';
import { graphLoops, stateReader } from './dep-graph';
import { SIZING, isContainer } from './task-attrs-checks';
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

/** `conflicting-attribute` when `parent` is a leaf with its own sizing or `milestone`. */
export function checkNewParent(ctx: EditContext, parent: TaskSymbol | null): Refused | null {
	if (!parent || isContainer(ctx, parent)) return null;
	const sites = parent.attrs.filter((a) => SIZING.has(a.keyword) || a.keyword === 'milestone');
	return sites.length > 0
		? refused(
				'conflicting-attribute',
				sites.map((s) => s.statement),
			)
		: null;
}

/**
 * The checks of the module comment after the edit: `tasks` are the old ids of the moved subtree
 * (mapped by `map`), `added` a new task's id.
 */
export function checkEdited(
	ctx: EditContext,
	edited: Edited,
	tasks: readonly TaskId[],
	map: (id: TaskId) => TaskId | null,
	added: TaskId | null,
	at: readonly SourceRange[],
): Refused | null {
	const before = beforeLoops(ctx);
	for (const [sc, now] of graphLoops(edited.snap, edited.index)) {
		const was = before.get(sc);
		if ((now.loop && !was?.loop) || (now.cycle && !was?.cycle)) return refused('cycle', at);
	}
	const old = tasks.length > 0 ? stateReader(ctx.ws, ctx.index) : null;
	const next = stateReader(edited.snap, edited.index);
	const effortOf = (sym: TaskSymbol | undefined): SourceRange | null =>
		sym?.attrs.find((a) => a.keyword === 'effort')?.statement ?? null;
	for (const id of tasks) {
		const effort = effortOf(ctx.index.tasks.get(id));
		const mapped = map(id);
		if (!effort || mapped === null || !edited.index.tasks.has(mapped)) continue;
		const had = (old?.(id).state.allocs.length ?? 0) > 0;
		if (had && next(mapped).state.allocs.length === 0) {
			return refused('conflicting-attribute', [effort]);
		}
	}
	if (added !== null) {
		const sym = edited.index.tasks.get(added);
		if (effortOf(sym) && next(added).state.allocs.length === 0) {
			return refused('conflicting-attribute', at);
		}
	}
	return null;
}

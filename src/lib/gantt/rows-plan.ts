// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's relative row commands as view planners (ADR-0018 decision 3): the dispatcher calls
 * them on the text now (`dispatchPlan`), so a step or an add is worked out on the tree the text has,
 * never on an outline that lags it.
 *
 * - `stepTaskPlan(task, step)`: Alt+Shift+arrows and the row menu's Up, Down, Indent and Outdent.
 *   The place is `stepTarget`'s on the fresh outline; with nowhere to go there it is `unchanged`
 *   with the view's sentence ("It cannot move that way."), which the view also says itself when
 *   its own tree has nowhere to go.
 * - `addTaskPlan(anchor, mode, name)`: Insert, Ctrl or Cmd+Enter, the row menu's Add and the
 *   toolbar +. The place is `addSpot`'s; `anchor` null is the end of the plan.
 * - A task that is gone, or whose id now names another declaration (`isSame`), is refused with
 *   the edit API's sentence for it; an anchor that is gone never falls back to the end of the plan.
 * - The intents and labels are the ones `planAction` gives a `reorder` and an `add`.
 *
 * Pure: they read only the `PlanBase` and the plain data they were made from.
 */
import type { PlanBase, ViewPlanned, ViewPlanner } from '../state/edits-types';
import { ganttActionStrings as S, gestureStrings, refusalStrings } from '../strings';
import type { TaskId } from '../tjp/index';
import { addSpot, type AddMode } from './add-task';
import { rootsOf, stepTarget, type Step } from './reorder';

/** The refusal for a task that is gone or no longer the same, or null when it is the same. */
export function goneTask(on: PlanBase, task: TaskId): ViewPlanned | null {
	if (on.isSame('task', task)) return null;
	const known = on.index.tasks.has(task);
	return {
		status: 'not-possible',
		message: refusalStrings[known ? 'target-changed' : 'unknown-target'],
		at: [],
	};
}

const treeOf = (on: PlanBase) => {
	const o = on.outline();
	return {
		tree: o.byKey,
		roots: rootsOf(
			o.byKey,
			o.tasks.map((n) => n.key),
		),
	};
};

const nameOf = (on: PlanBase, id: TaskId): string => {
	const t = on.index.tasks.get(id);
	return t?.name ?? t?.localId ?? id;
};

/** One place up or down, one level in or out, on the text now. */
export function stepTaskPlan(task: TaskId, step: Step): ViewPlanner {
	return (on) => {
		const gone = goneTask(on, task);
		if (gone) return gone;
		const { tree, roots } = treeOf(on);
		const place = stepTarget(tree, `task:${task}`, step, roots);
		if (!place) return { status: 'unchanged', message: gestureStrings.live.noPlace };
		return {
			status: 'intent',
			intent: { type: 'moveTask', task, parent: place.parent, index: place.index },
			label: { text: S.label.move(nameOf(on, task)), approx: false },
		};
	};
}

/** A new task named `name` after `anchor` or as its last subtask, on the text now. */
export function addTaskPlan(anchor: TaskId | null, mode: AddMode, name: string): ViewPlanner {
	return (on) => {
		const gone = anchor === null ? null : goneTask(on, anchor);
		if (gone) return gone;
		const { tree, roots } = treeOf(on);
		const spot = addSpot(tree, roots, anchor === null ? null : `task:${anchor}`, mode);
		if (!spot) return { status: 'unchanged', message: gestureStrings.live.noPlace };
		return {
			status: 'intent',
			intent: { type: 'addTask', parent: spot.parent, index: spot.index, name },
			label: { text: S.label.add(name), approx: false },
		};
	};
}

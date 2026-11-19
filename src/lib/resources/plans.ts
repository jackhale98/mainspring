// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The resource table's relative commands as view planners (ADR-0018 decision 3): the dispatcher
 * calls them on the text now (`dispatchPlan`).
 *
 * - `stepResourcePlan(id, step)`: W6's Alt+Shift+arrows and the row menu. The place is
 *   `stepTarget`'s on the fresh outline, planned with `planRegroup`; with nowhere to go there it is
 *   `unchanged` with the table's sentence (`R.table.nowhere`), and the planner's refusals
 *   (`not-a-group`, `into-itself`, `same-place`) keep their own sentences.
 * - `addResourcePlan(selected, kind, name)`: W7's + (Add person, Add group). The place is
 *   `addSpot`'s; `selected` null is the end of the list; a selection under a parent the index
 *   cannot name has no place and is refused. `name` is the trimmed name the flow checked
 *   (`usableName`).
 * - A resource that is gone, or whose id now names another declaration (`isSame`), is refused with
 *   the edit API's sentence for it; a gone `selected` never falls back to the end of the list.
 *
 * Pure: they read only the `PlanBase` and the plain data they were made from.
 */
import { rootsOf, stepTarget, type Step } from '../gantt/reorder';
import type { PlanBase, ViewPlanned, ViewPlanner } from '../state/edits-types';
import { refusalStrings } from '../strings';
import { resourceStrings as R } from '../strings-resources';
import type { ResourceId } from '../tjp/index';
import { addEdit } from './person-edit';
import { planRegroup } from './regroup';
import { addSpot } from './rows';

/** The refusal for a resource that is gone or no longer the same, or null when it is the same. */
function gone(on: PlanBase, id: ResourceId): ViewPlanned | null {
	if (on.isSame('resource', id)) return null;
	const known = on.index.resources.has(id);
	return {
		status: 'not-possible',
		message: refusalStrings[known ? 'target-changed' : 'unknown-target'],
		at: [],
	};
}

/** One place up or down, into the group above or out of its group, on the text now. */
export function stepResourcePlan(id: ResourceId, step: Step): ViewPlanner {
	return (on) => {
		const g = gone(on, id);
		if (g) return g;
		const o = on.outline();
		const roots = rootsOf(
			o.byKey,
			o.resources.map((n) => n.key),
		);
		const place = stepTarget(o.byKey, `resource:${id}`, step, roots);
		if (!place) return { status: 'unchanged', message: R.table.nowhere(step) };
		const plan = planRegroup(on.index, id, place.parent, place.index);
		return plan.status === 'intent'
			? { status: 'intent', intent: plan.intent, label: plan.label }
			: { status: 'not-possible', message: plan.message, at: plan.at };
	};
}

/** A new person or group named `name` where the + puts it for `selected`, on the text now. */
export function addResourcePlan(
	selected: ResourceId | null,
	kind: 'person' | 'group',
	name: string,
): ViewPlanner {
	return (on) => {
		const g = selected === null ? null : gone(on, selected);
		if (g) return g;
		const key = selected === null ? null : `resource:${selected}`;
		const spot = addSpot(on.outline().resources, key, kind, on.index);
		if (!spot) return { status: 'not-possible', message: R.table.addNowhere, at: [] };
		const e = addEdit(spot.parent, spot.index, name, kind);
		return { status: 'intent', intent: e.intent, label: e.label };
	};
}

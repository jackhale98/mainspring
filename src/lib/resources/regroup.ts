// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Regrouping people (phase-3.md 7.1 W6, 18.7): a drag of a table row, the keys Alt+Shift+Arrow, the
 * row menu's Indent and Outdent, and the details' "Group" select all become one `moveResource`
 * intent here, or a sentence saying why not. Pure: it reads the index only, and the dispatcher
 * applies the intent (one undo step, a toast, and the edit API's own refusals for the rest).
 *
 * - **A person moves into a group** by being dropped (or indented, or picked) under it. A group is
 *   a resource with members, or a new empty one ("Add group" makes a resource with no members, so
 *   a resource with no members and no allocation is a group that is still empty).
 * - **`not-a-group`**: the target is a resource that an `allocate` names. Making it a group would
 *   turn those allocations into group allocations (the task would then book its members), so the
 *   planner refuses and says so: "Dev 1 has tasks, so people cannot join it." (18.7). The edit API
 *   refuses the other leaf-to-group cases itself (`conflicting-attribute`: managers, bookings,
 *   `limits`, shifts).
 * - **`into-itself`**: the target is the resource or one of its members (the edit API's `cycle`,
 *   caught first so that the sentence is the table's).
 * - **`same-place`**: the resource is already there.
 * - The place is `(parent, index)` among the parent's other children, as `moveResource` takes it,
 *   counting only the siblings the index resolved.
 */
import { resourceStrings as R } from '../strings-resources';
import type { EditIntent } from '../tjp/edit/types';
import type { ResourceId, SourceRange, SymbolIndex } from '../tjp/index';
import { isAllocated } from './person';

export type RegroupRefusal = 'not-a-group' | 'into-itself' | 'same-place' | 'unknown';

export type Regrouped =
	| {
			readonly status: 'intent';
			readonly intent: EditIntent;
			readonly label: { readonly text: string; readonly approx: false };
	  }
	| {
			readonly status: 'not-possible';
			readonly reason: RegroupRefusal;
			readonly message: string;
			readonly at: readonly SourceRange[];
	  };

/** Whether `id` is `of` or lies under it. */
function within(index: SymbolIndex, id: ResourceId, of: ResourceId): boolean {
	for (let r: ResourceId | null = id, guard = 0; r !== null && guard < 1000; guard++) {
		if (r === of) return true;
		r = index.resources.get(r)?.parent ?? null;
	}
	return false;
}

/** Whether people may be put under `parent`: it is a group, or a resource nothing allocates. */
export function canTake(index: SymbolIndex, parent: ResourceId): boolean {
	const p = index.resources.get(parent);
	if (!p) return false;
	return p.children.length > 0 || !isAllocated(index, parent);
}

const nameOf = (index: SymbolIndex, id: ResourceId): string => index.resources.get(id)?.name ?? id;

/** The siblings of a place that the index resolved, without `except`. */
const siblingsAt = (index: SymbolIndex, parent: ResourceId | null, except: ResourceId): string[] =>
	(parent === null
		? [...index.resourceRoots]
		: [...(index.resources.get(parent)?.children ?? [])]
	).filter((id) => id !== except && index.resources.has(id));

/** The sentence for where a resource went, for the toast and the undo entry. */
export function regroupLabel(
	index: SymbolIndex,
	id: ResourceId,
	parent: ResourceId | null,
	from: ResourceId | null,
): string {
	const who = nameOf(index, id);
	if (parent !== null && parent !== from) return R.label.movedInto(who, nameOf(index, parent));
	if (parent === null && from !== null) return R.label.movedOut(who, nameOf(index, from));
	return R.label.reordered(who);
}

/**
 * Plans moving `id` to `index` among the children of `parent` (`null`: the top level), the number
 * of siblings before it excluding itself.
 */
export function planRegroup(
	idx: SymbolIndex,
	id: ResourceId,
	parent: ResourceId | null,
	at: number,
): Regrouped {
	const sym = idx.resources.get(id);
	if (!sym) return { status: 'not-possible', reason: 'unknown', message: R.refuse.unknown, at: [] };
	const header = [sym.decl.header];
	if (parent !== null) {
		if (within(idx, parent, id)) {
			return {
				status: 'not-possible',
				reason: 'into-itself',
				message: R.refuse.intoItself(nameOf(idx, id)),
				at: header,
			};
		}
		const p = idx.resources.get(parent);
		if (p && !canTake(idx, parent)) {
			return {
				status: 'not-possible',
				reason: 'not-a-group',
				message: R.refuse.notAGroup(nameOf(idx, parent)),
				at: [p.decl.header],
			};
		}
	}
	const siblings = siblingsAt(idx, parent, id);
	const place = Math.max(0, Math.min(at, siblings.length));
	const before = (
		parent === null ? [...idx.resourceRoots] : [...(idx.resources.get(parent)?.children ?? [])]
	)
		.filter((r) => idx.resources.has(r))
		.indexOf(id);
	if (sym.parent === parent && before === place) {
		return {
			status: 'not-possible',
			reason: 'same-place',
			message: R.refuse.samePlace,
			at: header,
		};
	}
	return {
		status: 'intent',
		intent: { type: 'moveResource', resource: id, parent, index: place },
		label: { text: regroupLabel(idx, id, parent, sym.parent), approx: false },
	};
}

/**
 * The details' "Group" select: moves `id` to the end of `parent`'s members (`null`: the top
 * level), the same plan as a drop there.
 */
export function planGroupSelect(
	idx: SymbolIndex,
	id: ResourceId,
	parent: ResourceId | null,
): Regrouped {
	const end = siblingsAt(idx, parent, id).length;
	return planRegroup(idx, id, parent, end);
}

/** The groups a resource can be put in: every resource outside its own subtree that can take people. */
export function groupChoices(
	idx: SymbolIndex,
	id: ResourceId,
): ReadonlyArray<{ id: ResourceId; name: string; level: number }> {
	const out: Array<{ id: ResourceId; name: string; level: number }> = [];
	const walk = (ids: readonly ResourceId[], level: number): void => {
		for (const r of ids) {
			const sym = idx.resources.get(r);
			if (!sym || r === id) continue;
			if (sym.textOnly === null && canTake(idx, r)) out.push({ id: r, name: sym.name ?? r, level });
			walk(sym.children, level + 1);
		}
	};
	walk(idx.resourceRoots, 0);
	return out;
}

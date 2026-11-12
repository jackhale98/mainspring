// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Conditions under which a resource cannot take a new child or move under a new parent
 * (resource-tree.ts), each an error TaskJuggler reports, refused as `conflicting-attribute`:
 *
 * - a leaf that must stay one gets a child: it is a manager (manager_is_group), has bookings
 *   (booking_group), opaque text or a macro body names it, as a task's `limits { resources …
 *   }` does (leaf_resource_id_expected), or a supplement assigns it shifts: `shifts` read after
 *   a resource has children is container_attribute (checkContainer). The child goes at the end
 *   of the leaf's declaration body (blocks.ts), so `shifts` there is read before it and stays
 *   valid; every supplement is read after it;
 * - the moved subtree assigns shifts under a parent chain that does too: children inherit shift
 *   assignments, which may not overlap (shift_assignment_overlap);
 * - the new parent chain lists a resource of the subtree as manager: the subtree inherits
 *   `managers`, and a resource cannot manage itself (manager_is_self).
 */
import type { ResourceSymbol, SourceRange } from '../index';
import { refused, type EditContext, type Refused } from './types';

export const insideAny = (r: SourceRange, list: readonly SourceRange[]): boolean =>
	list.some((o) => o.file === r.file && o.from <= r.from && r.to <= o.to);

/** The resources of `ids` the index knows. */
export const symbols = (ctx: EditContext, ids: readonly string[]): ResourceSymbol[] =>
	ids.flatMap((id) => {
		const s = ctx.index.resources.get(id);
		return s ? [s] : [];
	});

/** `parent` and its ancestors. */
function chain(ctx: EditContext, parent: ResourceSymbol | null): ResourceSymbol[] {
	const out: ResourceSymbol[] = [];
	for (
		let p = parent;
		p;
		p = p.parent === null ? null : (ctx.index.resources.get(p.parent) ?? null)
	)
		out.push(p);
	return out;
}

const SHIFTS: ReadonlySet<string> = new Set(['shifts', 'shift']);

const shiftSites = (r: ResourceSymbol): SourceRange[] =>
	r.attrs.filter((a) => SHIFTS.has(a.keyword)).map((a) => a.statement);

/**
 * `conflicting-attribute` when `parent` is a leaf that must stay one: some resource has it as
 * manager (manager_is_group), it has bookings (booking_group), opaque text or a macro body
 * names it, as a `limits` resource list does (leaf_resource_id_expected), or a supplement read
 * after the new child assigns it shifts (container_attribute).
 */
function leafBecomesGroup(ctx: EditContext, parent: ResourceSymbol | null): Refused | null {
	if (!parent || parent.children.length > 0) return null;
	const at = ctx.index.references
		.filter((r) => r.kind === 'resource' && r.via === 'managers' && r.target === parent.id)
		.map((r) => r.at);
	at.push(...parent.attrs.filter((a) => a.keyword === 'booking').map((a) => a.statement));
	for (const m of ctx.index.mentions('resource', parent.id)) at.push(m.at);
	at.push(
		...parent.attrs
			.filter((a) => SHIFTS.has(a.keyword) && a.site === 'supplement')
			.map((a) => a.statement),
	);
	return at.length > 0 ? refused('conflicting-attribute', at) : null;
}

/**
 * `conflicting-attribute` when the moved subtree assigns shifts and the new parent or one of its
 * ancestors does too: a child inherits its parent's shift assignments, and TaskJuggler rejects
 * overlapping ones (shift_assignment_overlap, seen in the engine check).
 */
function shiftsOverlap(
	ctx: EditContext,
	parent: ResourceSymbol | null,
	ids: readonly string[],
): Refused | null {
	if (!chain(ctx, parent).some((p) => shiftSites(p).length > 0)) return null;
	const at = symbols(ctx, ids).flatMap(shiftSites);
	return at.length > 0 ? refused('conflicting-attribute', at) : null;
}

/**
 * `conflicting-attribute` when the new parent's chain lists a resource of the moved subtree as
 * manager: the subtree inherits `managers`, and a resource cannot manage itself
 * (manager_is_self, checked natively).
 */
function selfManaged(
	ctx: EditContext,
	parent: ResourceSymbol | null,
	ids: readonly string[],
): Refused | null {
	const at: SourceRange[] = [];
	for (const p of chain(ctx, parent)) {
		const own = p.attrs.filter((a) => a.keyword === 'managers').map((a) => a.statement);
		for (const r of ctx.index.references) {
			if (r.via !== 'managers' || r.target === null || !ids.includes(r.target)) continue;
			if (own.some((st) => insideAny(r.at, [st]))) at.push(r.at);
		}
	}
	return at.length > 0 ? refused('conflicting-attribute', at) : null;
}

/** The first of the checks above that refuses a move of `ids` under `parent`, or null. */
export function checkNewParent(
	ctx: EditContext,
	parent: ResourceSymbol | null,
	ids: readonly string[],
): Refused | null {
	return (
		leafBecomesGroup(ctx, parent) ??
		shiftsOverlap(ctx, parent, ids) ??
		selfManaged(ctx, parent, ids)
	);
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Everything a person's details show (phase-3.md 9.6), read from the symbol index and from the
 * schedule the People views show, as plain data. The component only draws it and sends what the
 * person changes through the edit dispatcher; nothing here changes the text or computes a
 * schedule (ADR-0007).
 *
 * - **Fields** (`efficiency`, `rate`, `email`) come from the index as the task inspector's do
 *   (field.ts): own, inherited from the nearest parent group that writes it (display only; an edit
 *   writes the person's own statement), text-only with the reason, or unset.
 * - **Managers** accumulate: the person's own list and what every parent group's lists give. The
 *   edit API wants the whole list back (`resource-attrs.ts`), so the inherited ids stay in it.
 * - **Group**: the parent resource, if any. A resource with members is a group, which has no
 *   efficiency of its own worth editing in the engine's eyes (it is inherited by its members), but
 *   TaskJuggler allows it, so the fields are the same.
 * - **Booked** is the engine's bookings of the first active scenario, per task, as exact minutes
 *   (a group sums its members), and `allocated` is whether any `allocate` in the text names the
 *   person: a person who is allocated cannot become a group (`regroup.ts`, `not-a-group`).
 */
import type { Minutes, ScheduleResult } from '../../engine/protocol';
import { finishScenario } from '../schedule/finish';
import type { OutlineReason } from '../state/outline';
import type {
	AttrSite,
	ResourceId,
	ResourceSymbol,
	SourceRange,
	SymbolIndex,
	TaskId,
} from '../tjp/index';
import type { FieldState } from '../inspector/field';
import { ownSites, sameFileBefore, siteState, UNSET, type ReadBefore } from './sites';

export type PersonField = 'efficiency' | 'rate' | 'email';

/** What a list attribute (`managers`) writes on the person and what the parent groups give. */
export interface ManagersFact {
	readonly own: readonly ResourceId[];
	readonly inherited: readonly ResourceId[];
	readonly textOnly: SourceRange | null;
}

export interface BookedTask {
	readonly id: TaskId;
	readonly name: string;
	readonly minutes: Minutes;
}

export interface PersonDetails {
	readonly id: ResourceId;
	readonly sym: ResourceSymbol;
	readonly name: string;
	/** The whole declaration is text only (a macro builds it). */
	readonly declaration: OutlineReason | null;
	readonly group: { readonly id: ResourceId; readonly name: string } | null;
	/** It has members: a group of people rather than a person. */
	readonly isGroup: boolean;
	readonly efficiency: FieldState;
	readonly rate: FieldState;
	readonly email: FieldState;
	readonly managers: ManagersFact;
	/** An `allocate` in the plan names this resource. */
	readonly allocated: boolean;
	/** Tasks booked on the person (a group: on its members), the most time first. */
	readonly booked: readonly BookedTask[];
	readonly bookedMinutes: Minutes;
}

/**
 * Own site of a keyword, else the nearest parent group's own that was read before the resource's
 * header (display only; the edit API's rule: a statement below the member does not reach it).
 */
function readResourceField(
	index: SymbolIndex,
	sym: ResourceSymbol,
	keyword: PersonField,
	readBefore: ReadBefore,
): FieldState {
	const own = ownSites(index, sym.attrs, keyword).at(-1);
	if (own) return siteState(own);
	const seen = new Set<ResourceId>([sym.id]);
	let child = sym;
	for (let p = sym.parent; p !== null && !seen.has(p);) {
		seen.add(p);
		const up = index.resources.get(p);
		if (!up) return UNSET;
		const header = child.decl.header;
		const site = ownSites(index, up.attrs, keyword)
			.filter((s) => readBefore(s.statement, header))
			.at(-1);
		if (site) {
			const s = siteState(site);
			return s.kind === 'own'
				? {
						kind: 'inherited',
						text: s.text,
						from: up.id,
						fromName: up.name ?? up.id,
						at: s.at,
					}
				: s;
		}
		child = up;
		p = up.parent;
	}
	return UNSET;
}

const idsOf = (sites: readonly AttrSite[]): string[] =>
	sites.flatMap((s) => (s.parsed?.kind === 'idList' ? [...s.parsed.value] : []));

/** The person's own manager ids and what the groups above give, or where text-only blocks it. */
export function managersOf(
	index: SymbolIndex,
	sym: ResourceSymbol,
	readBefore: ReadBefore = sameFileBefore,
): ManagersFact {
	const mine = ownSites(index, sym.attrs, 'managers');
	const blocked = mine.find((s) => s.textOnly || s.parsed?.kind !== 'idList');
	const inherited: string[] = [];
	const seen = new Set<ResourceId>([sym.id]);
	let child = sym;
	for (let p = sym.parent; p !== null && !seen.has(p);) {
		seen.add(p);
		const up = index.resources.get(p);
		if (!up) break;
		// A group's list read after the member's header does not reach the member (props.ts).
		const header = child.decl.header;
		for (const id of idsOf(
			ownSites(index, up.attrs, 'managers').filter((s) => readBefore(s.statement, header)),
		)) {
			if (!inherited.includes(id)) inherited.push(id);
		}
		child = up;
		p = up.parent;
	}
	const own = idsOf(mine).filter((id) => !inherited.includes(id));
	return { own, inherited, textOnly: blocked ? blocked.statement : null };
}

/** Booked minutes per resource in the first active scenario (a group sums its members). */
export function bookedMinutes(result: ScheduleResult | null): ReadonlyMap<ResourceId, Minutes> {
	const out = new Map<ResourceId, Minutes>();
	const scenario = result ? finishScenario(result) : null;
	if (!result || scenario === null) return out;
	const parent = new Map(result.resources.map((r) => [r.id, r.parent]));
	for (const b of result.bookings) {
		if (b.scenario !== scenario) continue;
		let minutes = 0;
		for (const [s, e] of b.intervals) minutes += e - s;
		for (
			let r: ResourceId | null = b.resource, guard = 0;
			r !== null && guard < 64;
			r = parent.get(r) ?? null, guard++
		) {
			out.set(r, (out.get(r) ?? 0) + minutes);
		}
	}
	return out;
}

/** The tasks booked on a person (or a group's members), most time first, in the first scenario. */
export function bookedTasks(result: ScheduleResult | null, id: ResourceId): BookedTask[] {
	const scenario = result ? finishScenario(result) : null;
	if (!result || scenario === null) return [];
	const parent = new Map(result.resources.map((r) => [r.id, r.parent]));
	const within = (r: ResourceId): boolean => {
		for (
			let x: ResourceId | null = r, guard = 0;
			x !== null && guard < 64;
			x = parent.get(x) ?? null, guard++
		)
			if (x === id) return true;
		return false;
	};
	const byTask = new Map<TaskId, number>();
	for (const b of result.bookings) {
		if (b.scenario !== scenario || !within(b.resource)) continue;
		let minutes = 0;
		for (const [s, e] of b.intervals) minutes += e - s;
		byTask.set(b.task, (byTask.get(b.task) ?? 0) + minutes);
	}
	const names = new Map(result.tasks.map((t) => [t.id, t.name]));
	return [...byTask]
		.map(([task, minutes]) => ({ id: task, name: names.get(task) ?? task, minutes }))
		.sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

/** Whether an `allocate` item names the resource (a task's own or a supplement's). */
export const isAllocated = (index: SymbolIndex, id: ResourceId): boolean =>
	index.allocations.some((a) => a.resource === id);

/** The person's details, or null when the index has no such resource. */
export function personDetails(
	index: SymbolIndex,
	result: ScheduleResult | null,
	id: ResourceId,
	readBefore: ReadBefore = sameFileBefore,
): PersonDetails | null {
	const sym = index.resources.get(id);
	if (!sym) return null;
	const parent = sym.parent === null ? null : index.resources.get(sym.parent);
	const booked = bookedTasks(result, id);
	return {
		id,
		sym,
		name: sym.name ?? id,
		declaration: sym.textOnly ? sym.textOnly.reason : sym.expandedOnly ? 'expanded-only' : null,
		group: parent ? { id: parent.id, name: parent.name ?? parent.id } : null,
		isGroup: sym.children.length > 0,
		efficiency: readResourceField(index, sym, 'efficiency', readBefore),
		rate: readResourceField(index, sym, 'rate', readBefore),
		email: readResourceField(index, sym, 'email', readBefore),
		managers: managersOf(index, sym, readBefore),
		allocated: isAllocated(index, id),
		booked,
		bookedMinutes: booked.reduce((n, t) => n + t.minutes, 0),
	};
}

/** The resources a person can be managed by: every leaf outside their own subtree. */
export function managerChoices(
	index: SymbolIndex,
	id: ResourceId,
): ReadonlyArray<{ id: ResourceId; name: string }> {
	const inside = new Set<ResourceId>([id]);
	const walk = (r: ResourceId): void => {
		for (const c of index.resources.get(r)?.children ?? []) {
			inside.add(c);
			walk(c);
		}
	};
	walk(id);
	return [...index.resources.values()]
		.filter((r) => r.children.length === 0 && !inside.has(r.id) && r.textOnly === null)
		.map((r) => ({ id: r.id, name: r.name ?? r.id }));
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's filter by person and by flag (phase-3.md T19, "Amendments from T19"). A view state only: it
 * decides which rows of the task tree the Gantt shows and never touches the text or the schedule.
 * Pure functions, no DOM. The Gantt fetches this module when a filter is first on or its panel is
 * first open (the first-load JS budget); what a filter is lives in filter-model.ts.
 *
 * - A filter has an optional person and an optional flag; with both, a task must satisfy both.
 * - Only leaf tasks and milestones match (a container is a summary of its children). A match keeps
 *   its ancestors as context rows, so the tree stays readable; a task that matches nothing and
 *   has no matching descendant is left out.
 * - A task is "of" a person when the person is booked on it (the engine's `allocated` and its
 *   bookings), or when the person is the first candidate of one of its `allocate` items, written
 *   by name: the task asks for them even if nothing is booked yet (a task held up or run without
 *   them). An alternative that was not used, and a group the person belongs to, do not count
 *   unless the person was booked.
 * - A task carries a flag when it, or any ancestor, lists it in `flags` (TaskJuggler inherits
 *   `flags` down the tree). Flags come from the symbol index (the text): the engine's result does
 *   not carry them. A task declared by a macro (no id) matches nothing.
 */
import type { ScheduleResult } from '../../engine/protocol';
import type { OutlineNode } from '../state/outline';
import type { ReferenceSite, SourceRange, TaskId, TaskSymbol } from '../tjp/index';
import type { GanttFilter } from './filter-model';

/** The part of the symbol index the flags are read from. */
export interface FlagSource {
	readonly tasks: ReadonlyMap<TaskId, TaskSymbol>;
	readonly references: readonly ReferenceSite[];
}

const NONE: ReadonlySet<string> = new Set();

const within = (r: SourceRange, outer: SourceRange): boolean =>
	r.file === outer.file && outer.from <= r.from && r.to <= outer.to;

/**
 * The flags every task carries (its own and its ancestors'), by task id. A task without any is
 * not in the map. The names are as written when the flag is not declared.
 */
export function taskFlags(src: FlagSource): ReadonlyMap<TaskId, ReadonlySet<string>> {
	const byOwner = new Map<string, ReferenceSite[]>();
	for (const r of src.references) {
		if (r.kind !== 'flag' || r.via !== 'flags' || r.owner === null) continue;
		const list = byOwner.get(r.owner);
		if (list) list.push(r);
		else byOwner.set(r.owner, [r]);
	}
	const out = new Map<TaskId, ReadonlySet<string>>();
	const of = (id: TaskId, depth: number): ReadonlySet<string> => {
		const known = out.get(id);
		if (known) return known;
		const sym = src.tasks.get(id);
		if (!sym || depth > 1000) return NONE;
		// A resource can share the task's id: only statements of this task's own `flags` count.
		const sites = sym.attrs.filter((a) => a.keyword === 'flags').map((a) => a.statement);
		const own = (byOwner.get(id) ?? []).filter((r) => sites.some((s) => within(r.at, s)));
		const inherited = sym.parent === null ? NONE : of(sym.parent, depth + 1);
		if (own.length === 0 && inherited.size === 0) return NONE;
		const all = new Set(inherited);
		for (const r of own) all.add(r.target ?? r.written);
		out.set(id, all);
		return all;
	};
	for (const id of src.tasks.keys()) of(id, 0);
	return out;
}

/** The ids of the tasks that are "of" a person (see the module comment) in the shown scenario. */
export function tasksOfPerson(result: ScheduleResult | null, person: string): ReadonlySet<TaskId> {
	const out = new Set<TaskId>();
	// The shown scenario, as schedule/finish.ts names it (not imported: this module is a chunk of its own).
	const scenario = result?.project?.scenarios.find((s) => s.active)?.id ?? null;
	if (!result || scenario === null) return out;
	for (const t of result.tasks) {
		const s = t.scenarios[scenario];
		if (s?.allocated.includes(person) || s?.allocate.some((a) => a.candidates[0] === person)) {
			out.add(t.id);
		}
	}
	for (const b of result.bookings) {
		if (b.scenario === scenario && b.resource === person) out.add(b.task);
	}
	return out;
}

/** What `applyFilter` reads besides the outline. */
export interface FilterFacts {
	readonly flags: ReadonlyMap<TaskId, ReadonlySet<string>>;
	/** The tasks of the filter's person (`tasksOfPerson`); unused without a person. */
	readonly ofPerson: ReadonlySet<TaskId>;
}

export interface FilterView {
	/** The keys of the rows that match. */
	readonly matched: ReadonlySet<string>;
	/** The keys of the rows that show: the matches and their ancestors. */
	readonly keep: ReadonlySet<string>;
	/** The outline of the rows that show, in order, with `children`, `posinset` and `setsize` of that tree. */
	readonly nodes: readonly OutlineNode[];
}

/** The rows a filter keeps, or null when there is no filter (the whole outline shows). */
export function applyFilter(
	nodes: readonly OutlineNode[],
	filter: GanttFilter,
	facts: FilterFacts,
): FilterView | null {
	if (filter.person === null && filter.flag === null) return null;
	const byKey = new Map<string, OutlineNode>();
	for (const n of nodes) byKey.set(n.key, n);
	const matched = new Set<string>();
	const keep = new Set<string>();
	for (const n of nodes) {
		if (n.id === null || n.children.length > 0) continue;
		if (filter.person !== null && !facts.ofPerson.has(n.id)) continue;
		if (filter.flag !== null && !facts.flags.get(n.id)?.has(filter.flag)) continue;
		matched.add(n.key);
		for (
			let k: string | null = n.key;
			k !== null && !keep.has(k);
			k = byKey.get(k)?.parent ?? null
		) {
			keep.add(k);
		}
	}
	// The kept children of each node (null: the roots), in order.
	const kids = new Map<string | null, string[]>();
	const kept = nodes.filter((n) => keep.has(n.key));
	for (const n of kept) {
		const list = kids.get(n.parent);
		if (list) list.push(n.key);
		else kids.set(n.parent, [n.key]);
	}
	const shown: OutlineNode[] = kept.map((n) => {
		const list = kids.get(n.parent) ?? [];
		return {
			...n,
			children: kids.get(n.key) ?? [],
			posinset: list.indexOf(n.key) + 1,
			setsize: list.length,
		};
	});
	return { matched, keep, nodes: shown };
}

/** A flag the picker offers, with the number of leaf tasks that carry it. */
export interface FlagChoice {
	readonly flag: string;
	readonly count: number;
}

/** The flags some leaf task carries, by name, with how many do. */
export function flagChoices(
	nodes: readonly OutlineNode[],
	flags: ReadonlyMap<TaskId, ReadonlySet<string>>,
): FlagChoice[] {
	const counts = new Map<string, number>();
	for (const n of nodes) {
		if (n.id === null || n.children.length > 0) continue;
		for (const f of flags.get(n.id) ?? NONE) counts.set(f, (counts.get(f) ?? 0) + 1);
	}
	return [...counts]
		.map(([flag, count]) => ({ flag, count }))
		.sort((a, b) => a.flag.localeCompare(b.flag));
}

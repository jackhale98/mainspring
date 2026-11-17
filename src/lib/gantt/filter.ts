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
 * - A task carries a flag as TaskJuggler gives it (see `taskFlags`): its own, and its parent's as
 *   they were when the task was created. Flags come from the symbol index (the text): the
 *   engine's result does not carry them. A task declared by a macro (no id) matches nothing.
 * - Only a booking counts for a milestone and the person filter: TaskJuggler ignores the
 *   `allocate` a milestone inherits (TaskScenario.rb:583).
 */
import type { ScheduleResult } from '../../engine/protocol';
import type { OutlineNode } from '../state/outline';
import type { ReferenceSite, SourceRange, TaskId, TaskSymbol } from '../tjp/index';
import { compareParseOrder } from '../workspace/include-order';
import type { IncludeGraph } from '../workspace/workspace';
import type { GanttFilter } from './filter-model';

/** The part of the symbol index, and the include order, the flags are read from. */
export interface FlagSource {
	readonly tasks: ReadonlyMap<TaskId, TaskSymbol>;
	readonly references: readonly ReferenceSite[];
	/** For the reading order across includes (a site is read before a child's header or not). */
	readonly includes: IncludeGraph;
}

const NONE: ReadonlySet<string> = new Set();

const within = (r: SourceRange, outer: SourceRange): boolean =>
	r.file === outer.file && outer.from <= r.from && r.to <= outer.to;

/** The shown scenario and its parents: the scenarios whose `flags` apply in the chart. */
function scenarioChain(result: ScheduleResult | null): ReadonlySet<string> {
	const all = result?.project?.scenarios ?? [];
	const out = new Set<string>();
	for (let s = all.find((x) => x.active); s; s = all.find((x) => x.id === s?.parent)) {
		if (out.has(s.id)) break;
		out.add(s.id);
	}
	return out;
}

/**
 * The flags every task carries in the shown scenario, by task id; a task without any is not in the
 * map. The names are as written when the flag is not declared. TaskJuggler copies a parent's flags
 * into a child once, when the child's header is read (`inheritAttributes`), and `flags` is
 * scenario-specific, so, as `task-attrs-checks.ts` does for edits:
 * - a task's flags at creation are its parent's flags at the parent's creation, plus the parent's
 *   own `flags` read before this task's header (a `flags` after the child, or in a later
 *   `supplement`, is not inherited by it);
 * - its flags are those plus all of its own `flags`;
 * - only a statement with no scenario prefix, or one of the shown scenario or its parents, counts.
 * `purge flags` is not recorded by the index, so a purge is not applied (a task that purges
 * inherited flags still shows with them).
 */
export function taskFlags(
	src: FlagSource,
	result: ScheduleResult | null,
): ReadonlyMap<TaskId, ReadonlySet<string>> {
	const chain = scenarioChain(result);
	const byOwner = new Map<string, ReferenceSite[]>();
	for (const r of src.references) {
		if (r.kind !== 'flag' || r.via !== 'flags' || r.owner === null) continue;
		const list = byOwner.get(r.owner);
		if (list) list.push(r);
		else byOwner.set(r.owner, [r]);
	}
	/** Each of a task's own `flags` statements that apply, with the names it gives. */
	const ownOf = (sym: TaskSymbol): Array<{ at: SourceRange; ids: string[] }> =>
		sym.attrs
			.filter((a) => a.keyword === 'flags' && (a.scenario === null || chain.has(a.scenario)))
			.map((a) => ({
				at: a.statement,
				// A resource can share the task's id: only references inside this statement count.
				ids: (byOwner.get(sym.id) ?? [])
					.filter((r) => within(r.at, a.statement))
					.map((r) => r.target ?? r.written),
			}));
	const created = new Map<TaskId, ReadonlySet<string>>();
	const atCreation = (sym: TaskSymbol, depth: number): ReadonlySet<string> => {
		const known = created.get(sym.id);
		if (known) return known;
		const parent = sym.parent === null ? undefined : src.tasks.get(sym.parent);
		let set = NONE;
		if (parent && depth < 1000) {
			const all = new Set(atCreation(parent, depth + 1));
			for (const o of ownOf(parent)) {
				if (compareParseOrder(src.includes, o.at, sym.decl.header, 'first') < 0) {
					for (const id of o.ids) all.add(id);
				}
			}
			set = all;
		}
		created.set(sym.id, set);
		return set;
	};
	const out = new Map<TaskId, ReadonlySet<string>>();
	for (const sym of src.tasks.values()) {
		const all = new Set(atCreation(sym, 0));
		for (const o of ownOf(sym)) for (const id of o.ids) all.add(id);
		if (all.size > 0) out.set(sym.id, all);
	}
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
		// A milestone ignores the `allocate` it inherits (TaskScenario.rb:583): only a booking counts.
		const asked = !t.milestone && s?.allocate.some((a) => a.candidates[0] === person);
		if (s?.allocated.includes(person) || asked) out.add(t.id);
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

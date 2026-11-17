// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What each Calendar day shows (phase-3.md 9.5; ADR-0014 and its 2026-11-16 amendment): the global
 * holidays, the scope's leaves, whether the day is a working day, and the milestones.
 *
 * - **Leaves are the text's.** TaskJuggler 3.8.4 keeps no leave names (`ProjectLeave.name` and the
 *   leave lists of a resource are nameless), so every leave with a name, a type and a place to
 *   edit is a text item read from the symbol index (paint-items.ts): Everyone's file-level items,
 *   and for a person their own, their parent resources' and the global ones.
 * - **Text-only leave.** For each leave type the engine shows on a day (v3 `ProjectInfo.leaves`, or
 *   the person's `leaves`) that no text item of that type names on it, the leave comes from a shift
 *   or a macro. It is listed with the engine's type, no name and no item, and says "From a shift
 *   or macro. Edit as text." (`textOnly`), also when other text items touch the day (T16 review). The engine's person leaves count only the working time lost, so a leave on a
 *   non-working day is shown from its text item alone.
 * - **Working day.** A day with any slot of working time, or of working time lost to leave: the
 *   person's `workingTime` (null is the project's), their leave slots, or for Everyone and a group
 *   the project's. A day with none and no leave is non-working (a weekend, or off by the hours).
 *   A day under two global leaves is in neither engine list; its text items still show.
 * - **Milestones.** A task with `milestone: true` whose start (first active scenario) is in the
 *   day.
 *
 * Built once per result, index, scope and grid; a day's facts are made when asked for and kept.
 */
import type { Minutes, ScheduleResult } from '../../engine/protocol';
import { finishScenario } from '../schedule/finish';
import type { ResourceId, SymbolIndex, TaskId } from '../tjp/index';
import type { LeaveType } from '../tjp/values';
import type { CalendarGrid } from './grid';
import type { PaintScope } from './paint';
import { leaveRank, scopeItems, type PaintItem } from './paint-items';

/** One leave on a day, as the details list it. */
export interface LeaveEntry {
	readonly type: LeaveType;
	readonly name: string | null;
	/** Whose it is: the scope's own, a parent group's, or Everyone's. */
	readonly from: 'own' | 'group' | 'global';
	/** The parent group's name for `group`. */
	readonly who: string | null;
	/** The text item; null when no item names it (a shift or a macro). */
	readonly item: PaintItem | null;
}

export interface MilestoneEntry {
	readonly task: TaskId;
	readonly name: string;
}

export interface DayFacts {
	/** Whether the scope has working time on the day, or lost to leave. */
	readonly working: boolean;
	/** The global leaves of the day (all scopes see them). */
	readonly holidays: readonly LeaveEntry[];
	/** The scope's own leaves and its groups' (empty for Everyone). */
	readonly leaves: readonly LeaveEntry[];
	/** Some leave of the day has no text item. */
	readonly textOnly: boolean;
	/** The strongest leave type of the day (TaskJuggler's precedence), or null. */
	readonly top: LeaveType | null;
	readonly milestones: readonly MilestoneEntry[];
}

export interface FactsInput {
	readonly result: ScheduleResult;
	readonly index: SymbolIndex;
	readonly scope: PaintScope;
	readonly grid: CalendarGrid;
}

type Pair = readonly [start: Minutes, end: Minutes];

/** Whether any `[start, end)` pair of an ascending list overlaps `[a, b)`. */
export function touchesAny(pairs: readonly Pair[], a: Minutes, b: Minutes): boolean {
	let lo = 0;
	let hi = pairs.length;
	// The first pair that ends after `a`.
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((pairs[mid] as Pair)[1] > a) hi = mid;
		else lo = mid + 1;
	}
	const p = pairs[lo];
	return p !== undefined && p[0] < b;
}

const overlaps = (i: { from: Minutes; to: Minutes }, a: Minutes, b: Minutes): boolean =>
	i.to > a && i.from < b;

/** The strongest of some types by TaskJuggler's precedence, or null. */
export function strongest(types: Iterable<LeaveType>): LeaveType | null {
	let best: LeaveType | null = null;
	for (const t of types) if (best === null || leaveRank(t) > leaveRank(best)) best = t;
	return best;
}

/** The ancestors of a resource, nearest first. */
function ancestors(index: SymbolIndex, id: ResourceId): ResourceId[] {
	const out: ResourceId[] = [];
	const seen = new Set<ResourceId>([id]);
	for (let p = index.resources.get(id)?.parent ?? null; p !== null && !seen.has(p);) {
		seen.add(p);
		out.push(p);
		p = index.resources.get(p)?.parent ?? null;
	}
	return out;
}

export function prepareFacts(input: FactsInput): (day: number) => DayFacts {
	const { result, index, scope, grid } = input;
	const project = result.project;
	const scenario = finishScenario(result);
	const startEpoch = project ? Math.round(Date.parse(project.start) / 1000) : 0;

	const globalItems = scopeItems(index, { kind: 'global' }, startEpoch);
	const own: PaintItem[] = [];
	const groups: Array<{ item: PaintItem; who: string }> = [];
	let engineWorking: readonly Pair[] = project?.workingTime ?? [];
	let engineLeaves: Array<{ type: LeaveType; iv: Pair }> = (project?.leaves ?? []).map((l) => ({
		type: l.type,
		iv: l.interval,
	}));
	if (scope.kind === 'resource') {
		own.push(...scopeItems(index, scope, startEpoch));
		for (const g of ancestors(index, scope.resource)) {
			const who = index.resources.get(g)?.name ?? g;
			for (const item of scopeItems(index, { kind: 'resource', resource: g }, startEpoch)) {
				groups.push({ item, who });
			}
		}
		const r = result.resources.find((x) => x.id === scope.resource);
		const rs = scenario === null ? undefined : r?.scenarios[scenario];
		// A group has no time of its own (v3): it reads as the project's.
		if (r && !r.group && rs) {
			engineWorking = rs.workingTime ?? engineWorking;
			engineLeaves = rs.leaves.flatMap((l) => l.intervals.map((iv) => ({ type: l.type, iv })));
		} else engineLeaves = [];
	}

	const milestones = new Map<number, MilestoneEntry[]>();
	if (scenario !== null) {
		for (const t of result.tasks) {
			if (!t.milestone) continue;
			const s = t.scenarios[scenario];
			if (!s || s.start === null) continue;
			const d = grid.dayAt(s.start);
			if (d < 0) continue;
			let list = milestones.get(d);
			if (!list) milestones.set(d, (list = []));
			list.push({ task: t.id, name: t.name });
		}
	}

	const made = new Map<number, DayFacts>();
	const entry = (
		item: PaintItem,
		from: LeaveEntry['from'],
		who: string | null = null,
	): LeaveEntry => ({ type: item.type, name: item.name, from, who, item });

	return (i) => {
		const kept = made.get(i);
		if (kept) return kept;
		const d = grid.days[i];
		if (!d) throw new RangeError(`no day ${i}`);
		const a = d.from;
		const b = d.to;
		const holidays = globalItems.filter((x) => overlaps(x, a, b)).map((x) => entry(x, 'global'));
		const leaves: LeaveEntry[] = [
			...own.filter((x) => overlaps(x, a, b)).map((x) => entry(x, 'own')),
			...groups.filter((g) => overlaps(g.item, a, b)).map((g) => entry(g.item, 'group', g.who)),
		];
		// What the engine shows with no text item behind it: a shift's or a macro's leave. It is
		// found per type: a day can hold a text item of one type and a macro's of another (the engine
		// keeps the stronger where they overlap), so a type the day's text items do not name is
		// listed as text only, however many other items touch the day.
		const named = new Set<LeaveType>([...holidays, ...leaves].map((e) => e.type));
		for (const l of engineLeaves) {
			if (!(l.iv[1] > a && l.iv[0] < b) || named.has(l.type)) continue;
			named.add(l.type);
			const global = scope.kind === 'global';
			const e: LeaveEntry = {
				type: l.type,
				name: null,
				from: global ? 'global' : 'own',
				who: null,
				item: null,
			};
			(global ? holidays : leaves).push(e);
		}
		const all = [...holidays, ...leaves];
		const facts: DayFacts = {
			working: touchesAny(engineWorking, a, b) || engineLeavesTouch(engineLeaves, a, b, scope),
			holidays,
			leaves,
			textOnly: all.some((e) => e.item === null),
			top: strongest(all.map((e) => e.type)),
			milestones: milestones.get(i) ?? [],
		};
		made.set(i, facts);
		return facts;
	};
}

/**
 * A person's leave slots are working time lost, so a day with one is a working day. Global leaves
 * are not: the project's `workingTime` already leaves them out, and which days they sit on is not
 * known (a holiday on a Saturday is no lost working day), so for Everyone only working time counts.
 */
function engineLeavesTouch(
	leaves: ReadonlyArray<{ iv: Pair }>,
	a: Minutes,
	b: Minutes,
	scope: PaintScope,
): boolean {
	return scope.kind === 'resource' && leaves.some((l) => l.iv[1] > a && l.iv[0] < b);
}

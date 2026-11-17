// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the explainer and demand read from one result (explain.ts, demand.ts), made once per
 * `Availability` (one result, one scenario) and shared by every `explainTask` call on it: tasks by
 * id, which tasks are containers, each task's bookings per person and merged over its people, the
 * leaf people of each resource, and the global leaves as TaskJuggler's resource scoreboard holds
 * them. All of it is engine data, read as is (ADR-0007, ADR-0014 #4); nothing here schedules.
 */
import type {
	EngineLeaveType,
	Minutes,
	ProjectInfo,
	ScheduleResult,
	TaskResult,
	TaskScenarioResult,
} from '../../engine/protocol';
import type { ResourceId, TaskId } from '../tjp/index';
import { globalLeaveOverlaps } from '../workload/availability';
import { frameEndOf } from '../workload/axis';
import { mergePairs } from '../workload/intervals';
import type { Availability, IntervalSet } from '../workload/types';
import type { ExplainContext } from './explain-types';

/** A run of slots under the global leaves, with the type the resource scoreboard gives it. */
export interface GlobalPiece {
	readonly from: Minutes;
	readonly to: Minutes;
	readonly type: EngineLeaveType;
}

export interface Prep {
	readonly result: ScheduleResult;
	readonly scenario: string;
	readonly frameEnd: Minutes;
	/** `ProjectInfo.start` in epoch seconds, for written dates. */
	readonly startEpoch: number;
	readonly resolution: number;
	readonly tasks: ReadonlyMap<TaskId, TaskResult>;
	readonly containers: ReadonlySet<TaskId>;
	/** Every booking of a task over all its people, merged. */
	booked(task: TaskId): IntervalSet;
	/** One person's bookings on one task, as sent. */
	own(person: ResourceId, task: TaskId): IntervalSet;
	/** The leaf people of a resource (itself for a person) that have data in the scenario. */
	leavesOf(id: ResourceId): readonly ResourceId[];
	/** `ProjectInfo.workingTime`: the project calendar. */
	readonly projectTime: IntervalSet;
	/** The global leaves on the slot grid, disjoint, ascending, the later leave on top. */
	readonly global: readonly GlobalPiece[];
	/** Slots under two or more global leaves (off hours on every scoreboard; ADR-0014 amendment). */
	readonly overlaps: IntervalSet;
	scenarioOf(task: TaskId): TaskScenarioResult | null;
}

const NONE: IntervalSet = [];
const cache = new WeakMap<Availability, Prep>();

/** The prep of a context, made once per `Availability` and reused while the result is the same. */
export function prepOf(ctx: ExplainContext): Prep {
	const hit = cache.get(ctx.availability);
	if (hit && hit.result === ctx.result && hit.scenario === ctx.scenario) return hit;
	const prep = buildPrep(ctx.result, ctx.scenario, ctx.availability);
	cache.set(ctx.availability, prep);
	return prep;
}

function buildPrep(result: ScheduleResult, scenario: string, avail: Availability): Prep {
	const p = result.project;
	const tasks = new Map<TaskId, TaskResult>();
	const containers = new Set<TaskId>();
	for (const t of result.tasks) {
		tasks.set(t.id, t);
		if (t.parent !== null) containers.add(t.parent);
	}

	const perTask = new Map<TaskId, Map<ResourceId, IntervalSet>>();
	for (const b of result.bookings) {
		if (b.scenario !== scenario || b.intervals.length === 0) continue;
		let m = perTask.get(b.task);
		if (!m) perTask.set(b.task, (m = new Map()));
		m.set(b.resource, b.intervals);
	}
	const merged = new Map<TaskId, IntervalSet>();
	const booked = (task: TaskId): IntervalSet => {
		let set = merged.get(task);
		if (!set) {
			const lists = [...(perTask.get(task)?.values() ?? [])];
			set = lists.length === 1 ? (lists[0] as IntervalSet) : mergePairs(lists.flat());
			merged.set(task, set);
		}
		return set;
	};

	const kids = new Map<ResourceId, ResourceId[]>();
	const isGroup = new Map<ResourceId, boolean>();
	for (const r of result.resources) {
		isGroup.set(r.id, r.group);
		if (r.parent === null) continue;
		let list = kids.get(r.parent);
		if (!list) kids.set(r.parent, (list = []));
		list.push(r.id);
	}
	const leaves = new Map<ResourceId, readonly ResourceId[]>();
	const leavesOf = (id: ResourceId): readonly ResourceId[] => {
		let out = leaves.get(id);
		if (out) return out;
		const found: ResourceId[] = [];
		const seen = new Set<ResourceId>();
		const walk = (r: ResourceId): void => {
			if (seen.has(r)) return;
			seen.add(r);
			if (!isGroup.get(r)) {
				if (avail.people.has(r)) found.push(r);
				return;
			}
			for (const k of kids.get(r) ?? []) walk(k);
		};
		walk(id);
		out = found;
		leaves.set(id, out);
		return out;
	};

	return {
		result,
		scenario,
		frameEnd: p ? frameEndOf(p) : 0,
		startEpoch: p ? Date.parse(p.start) / 1000 : 0,
		resolution: p?.timingResolutionMin ?? 60,
		tasks,
		containers,
		booked,
		own: (person, task) => perTask.get(task)?.get(person) ?? NONE,
		leavesOf,
		projectTime: p?.workingTime ?? NONE,
		global: p ? paintGlobalLeaves(p) : [],
		overlaps: p ? globalLeaveOverlaps(p) : NONE,
		scenarioOf: (task) => tasks.get(task)?.scenarios[scenario] ?? null,
	};
}

/**
 * The global leaves as ResourceScenario#initScoreboard marks them: each leave covers the slots
 * from `dateToIdx(start)` up to but not including `dateToIdx(end)` (truncated and clamped into
 * the frame, as `globalLeaveOverlaps` reads them), and a later leave overwrites an earlier one's
 * type on the slots they share.
 */
export function paintGlobalLeaves(p: ProjectInfo): GlobalPiece[] {
	const res = p.timingResolutionMin;
	const size = Math.floor(frameEndOf(p) / res);
	if (size <= 0 || p.leaves.length === 0) return [];
	const idx = (m: Minutes): number => Math.min(Math.max(Math.trunc(m / res), 0), size - 1);
	const spans = p.leaves
		.map((l) => ({ a: idx(l.interval[0]), b: idx(l.interval[1]), type: l.type }))
		.filter((s) => s.b > s.a);
	const cuts = [...new Set(spans.flatMap((s) => [s.a, s.b]))].sort((x, y) => x - y);
	const out: GlobalPiece[] = [];
	for (let i = 0; i + 1 < cuts.length; i++) {
		const a = cuts[i] as number;
		const b = cuts[i + 1] as number;
		let type: EngineLeaveType | null = null;
		for (const s of spans) if (s.a <= a && b <= s.b) type = s.type;
		if (type === null) continue;
		const last = out[out.length - 1];
		if (last && last.to === a * res && last.type === type) {
			out[out.length - 1] = { from: last.from, to: b * res, type };
		} else out.push({ from: a * res, to: b * res, type });
	}
	return out;
}

/** The global leave type at minute m, or null. */
export function globalTypeAt(global: readonly GlobalPiece[], m: Minutes): EngineLeaveType | null {
	let lo = 0;
	let hi = global.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((global[mid] as GlobalPiece).to <= m) lo = mid + 1;
		else hi = mid;
	}
	const g = global[lo];
	return g && g.from <= m ? g.type : null;
}

/** The part of a set inside [from, to), by binary search (the set is ascending and disjoint). */
export function clip(set: IntervalSet, from: Minutes, to: Minutes): Array<[Minutes, Minutes]> {
	let lo = 0;
	let hi = set.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((set[mid] as readonly [Minutes, Minutes])[1] <= from) lo = mid + 1;
		else hi = mid;
	}
	const out: Array<[Minutes, Minutes]> = [];
	for (let i = lo; i < set.length; i++) {
		const [s, e] = set[i] as readonly [Minutes, Minutes];
		if (s >= to) break;
		out.push([Math.max(s, from), Math.min(e, to)]);
	}
	return out;
}

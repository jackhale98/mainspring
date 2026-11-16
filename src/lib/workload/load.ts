// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The load model (phase-3.md 6.2, `LoadModel` in types.ts): per heatmap row and bucket, the
 * minutes booked, available, lost to leave, held and unmet, the band of each cell, and the tasks
 * of a cell on demand. Display data (ADR-0007, ADR-0014 #4): a pure function of one result, its
 * `Availability`, the symbol index and the demand marks. It never schedules.
 *
 * - **Rows** come from the symbol index (the text is the source, as the Gantt's outline is): its
 *   resources in declaration pre-order, a collapsed group's members hidden. A resource the result
 *   does not know yet (text ahead of the schedule) has zeros. A group row is the sum of the leaf
 *   members under it in the index, whether or not they are shown.
 * - **Booked, available and leave** are exact sums of engine intervals per bucket
 *   (`PersonAvailability`), plus, for the leave hatch only, the working time lost where two
 *   global leaves overlap (`overlapLeaveOf`, the ADR-0014 amendment).
 * - **Held and unmet** are each `DemandMarks` entry's window intersected with the person's
 *   working time and the bucket, summed over the entries (types.ts). Demand comes from T10's
 *   `demandOf`; `null` gives zeros. This is the seam: the model reads the marks and nothing else
 *   of the explainer.
 * - Every array is the model's own: no two rows share one, and nothing mutates them after the
 *   build. Sums of the same working-time list (people on the project's hours share
 *   `ProjectInfo.workingTime`) are computed once per build.
 */
// T9: an `availability` of another revision than `result` (a caller bug: the contract makes it
// once per result) is not trusted; it is rebuilt from the result for the same scenario.
import type { DemandEntry, DemandMarks } from '../schedule/explain-types';
import type { ResourceId, SymbolIndex, TaskId } from '../tjp/index';
import { availabilityOf, globalLeaveOverlaps, overlapLeaveOf } from './availability';
import { bucketAxis, emptyAxis } from './axis';
import { bandOf } from './bands';
import { addBucketSums, minutesIn } from './intervals';
import type {
	Availability,
	Band,
	BucketAxis,
	BuildLoadFn,
	CellTask,
	IntervalSet,
	LoadModel,
	LoadRow,
	PersonAvailability,
	Thresholds,
	WithDimmedFn,
} from './types';

interface Series {
	readonly booked: Int32Array;
	readonly available: Int32Array;
	readonly leave: Int32Array;
	readonly held: Int32Array;
	readonly unmet: Int32Array;
}

/** What every view of one model shares (`withDimmed` re-wraps it). */
interface Core {
	readonly revision: number;
	readonly scenario: string;
	readonly axis: BucketAxis;
	readonly rows: readonly LoadRow[];
	readonly series: readonly Series[];
	/** Per row, the leaf people its minutes sum (the person itself for a leaf row). */
	readonly members: ReadonlyArray<readonly ResourceId[]>;
	readonly people: Availability['people'];
	readonly demand: DemandMarks | null;
	readonly index: SymbolIndex;
	/** Task pre-order in the result, to order a cell's tasks. */
	readonly taskOrder: ReadonlyMap<TaskId, number>;
	readonly cells: Map<number, readonly CellTask[]>;
}

const NO_ENTRIES: readonly DemandEntry[] = [];

class Model implements LoadModel {
	readonly revision: number;
	readonly scenario: string;
	readonly axis: BucketAxis;
	readonly rows: readonly LoadRow[];
	readonly booked: readonly Int32Array[];
	readonly available: readonly Int32Array[];
	readonly leave: readonly Int32Array[];
	readonly held: readonly Int32Array[];
	readonly unmet: readonly Int32Array[];
	readonly #core: Core;

	constructor(
		core: Core,
		readonly dimmed: boolean,
	) {
		this.#core = core;
		this.revision = core.revision;
		this.scenario = core.scenario;
		this.axis = core.axis;
		this.rows = core.rows;
		this.booked = core.series.map((s) => s.booked);
		this.available = core.series.map((s) => s.available);
		this.leave = core.series.map((s) => s.leave);
		this.held = core.series.map((s) => s.held);
		this.unmet = core.series.map((s) => s.unmet);
	}

	band(row: number, col: number, t: Thresholds): Band {
		const s = this.#core.series[row];
		if (!s || !(col >= 0 && col < this.axis.count)) return 'off';
		return bandOf(
			{
				booked: s.booked[col] as number,
				available: s.available[col] as number,
				held: s.held[col] as number,
				unmet: s.unmet[col] as number,
			},
			t,
		);
	}

	cellTasks(row: number, col: number): readonly CellTask[] {
		const core = this.#core;
		if (!(row >= 0 && row < core.rows.length && col >= 0 && col < this.axis.count)) return [];
		const key = row * this.axis.count + col;
		let list = core.cells.get(key);
		if (!list) core.cells.set(key, (list = cellTasksOf(core, row, col)));
		return list;
	}

	/** The core of a model this module built, or null. */
	static coreOf(m: LoadModel): Core | null {
		return #core in m ? (m as Model).#core : null;
	}
}

function cellTasksOf(core: Core, row: number, col: number): readonly CellTask[] {
	const from = core.axis.bounds[col] as number;
	const to = core.axis.bounds[col + 1] as number;
	const group = (core.rows[row] as LoadRow).group;
	const booked = new Map<TaskId, number>();
	const held = new Map<TaskId, number>();
	const unmet = new Map<TaskId, number>();
	const add = (m: Map<TaskId, number>, task: TaskId, n: number): void => {
		m.set(task, (m.get(task) ?? 0) + n);
	};
	for (const id of core.members[row] ?? []) {
		const person = core.people.get(id);
		for (const t of person?.tasks ?? []) {
			const n = minutesIn(t.intervals, from, to);
			if (n > 0) add(booked, t.task, n);
		}
		const working = person?.working ?? [];
		const demand = (m: Map<TaskId, number>, entries: readonly DemandEntry[]): void => {
			for (const { task, window } of entries) {
				const lo = Math.max(window[0], from);
				const hi = Math.min(window[1], to);
				if (hi > lo) add(m, task, minutesIn(working, lo, hi));
			}
		};
		demand(held, core.demand?.held.get(id) ?? NO_ENTRIES);
		demand(unmet, core.demand?.unmet.get(id) ?? NO_ENTRIES);
	}
	const rank = (task: TaskId): number => core.taskOrder.get(task) ?? Number.MAX_SAFE_INTEGER;
	const out: CellTask[] = [];
	const list = (m: Map<TaskId, number>, kind: CellTask['kind']): void => {
		const entries = [...m].sort(
			(a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || (a[0] < b[0] ? -1 : 1),
		);
		for (const [task, minutes] of entries) {
			const movable = kind === 'booked' && !group && movableTask(core.index, task);
			out.push({ task, minutes, kind, movable });
		}
	};
	// T9: 6.2 gives the order "booked, then held or unmet"; within each kind the tasks are by
	// minutes, most first, then in task pre-order.
	list(booked, 'booked');
	list(held, 'held');
	list(unmet, 'unmet');
	return out;
}

/** A booked task a drag may start from: one the text declares and can edit (9.4). */
// T9: the planner (T12) gives the drop's refusals (`via-group`, `inherited`, alternatives); a
// task the index does not name, or names as text-only or expanded-only, does not drag at all, as
// in the lanes (9.4, "Text-only tasks show the badge and do not drag").
function movableTask(index: SymbolIndex, task: TaskId): boolean {
	const sym = index.tasks.get(task);
	return sym !== undefined && sym.textOnly === null && !sym.expandedOnly;
}

export const buildLoad: BuildLoadFn = (i) => {
	const { result, index, zones, kind, collapsed, demand } = i;
	const project = result.project;
	const availability =
		i.availability.revision === result.revision
			? i.availability
			: availabilityOf(result, i.availability.scenario);
	const axis = project ? bucketAxis(project, zones, kind) : emptyAxis(kind);
	const bounds = axis.bounds;
	const count = axis.count;
	const runs = project ? globalLeaveOverlaps(project) : [];
	const sumsOf = new Map<IntervalSet, Int32Array>();
	const sums = (set: IntervalSet): Int32Array => {
		let s = sumsOf.get(set);
		if (!s) {
			s = new Int32Array(count);
			addBucketSums(set, bounds, s);
			sumsOf.set(set, s);
		}
		return s;
	};
	const demandSums = (person: PersonAvailability | undefined, entries: readonly DemandEntry[]) => {
		const out = new Int32Array(count);
		if (person) {
			for (const { window } of entries) {
				addBucketSums(person.working, bounds, out, window[0], window[1]);
			}
		}
		return out;
	};
	const leafSeries = (id: ResourceId): Series => {
		const person = availability.people.get(id);
		if (!person) {
			const zero = (): Int32Array => new Int32Array(count);
			return { booked: zero(), available: zero(), leave: zero(), held: zero(), unmet: zero() };
		}
		const leave = new Int32Array(count);
		for (const l of person.leave) addBucketSums(l.intervals, bounds, leave);
		if (project && runs.length > 0) {
			addBucketSums(overlapLeaveOf(project, zones, person, runs), bounds, leave);
		}
		return {
			booked: sums(person.booked).slice(),
			available: sums(person.working).slice(),
			leave,
			held: demandSums(person, demand?.held.get(id) ?? NO_ENTRIES),
			unmet: demandSums(person, demand?.unmet.get(id) ?? NO_ENTRIES),
		};
	};

	const rows: LoadRow[] = [];
	const series: Series[] = [];
	const members: ResourceId[][] = [];
	const leafMemo = new Map<ResourceId, Series>();
	const leafOf = (id: ResourceId): Series => {
		let s = leafMemo.get(id);
		if (!s) leafMemo.set(id, (s = leafSeries(id)));
		return s;
	};
	const leavesUnder = (id: ResourceId, into: ResourceId[], seen: Set<ResourceId>): void => {
		if (seen.has(id)) return;
		seen.add(id);
		const kids = index.resources.get(id)?.children ?? [];
		if (kids.length === 0) into.push(id);
		for (const k of kids) leavesUnder(k, into, seen);
	};
	const walk = (id: ResourceId, depth: number, seen: Set<ResourceId>): void => {
		const sym = index.resources.get(id);
		if (!sym || seen.has(id)) return;
		seen.add(id);
		const group = sym.children.length > 0;
		const expanded = group ? !collapsed.has(id) : null;
		rows.push({
			id,
			name: sym.name ?? id,
			depth,
			group,
			expanded,
			textOnly: sym.textOnly?.reason ?? (sym.expandedOnly ? 'expanded-only' : null),
		});
		if (group) {
			const leaves: ResourceId[] = [];
			leavesUnder(id, leaves, new Set());
			members.push(leaves);
			series.push(groupSeries(leaves.map(leafOf), count));
		} else {
			members.push([id]);
			// A leaf row owns its arrays; a later group sum only reads them.
			series.push(leafOf(id));
		}
		if (expanded !== false) for (const k of sym.children) walk(k, depth + 1, seen);
	};
	const seen = new Set<ResourceId>();
	for (const root of index.resourceRoots) walk(root, 0, seen);

	const taskOrder = new Map<TaskId, number>();
	result.tasks.forEach((t, n) => taskOrder.set(t.id, n));
	const core: Core = {
		revision: result.revision,
		scenario: availability.scenario,
		axis,
		rows,
		series,
		members,
		people: availability.people,
		demand,
		index,
		taskOrder,
		cells: new Map(),
	};
	return new Model(core, false);
};

function groupSeries(parts: readonly Series[], count: number): Series {
	const sum = (pick: (s: Series) => Int32Array): Int32Array => {
		const out = new Int32Array(count);
		for (const p of parts) {
			const a = pick(p);
			for (let c = 0; c < count; c++) out[c] = (out[c] as number) + (a[c] as number);
		}
		return out;
	};
	return {
		booked: sum((s) => s.booked),
		available: sum((s) => s.available),
		leave: sum((s) => s.leave),
		held: sum((s) => s.held),
		unmet: sum((s) => s.unmet),
	};
}

export const withDimmed: WithDimmedFn = (m, dimmed) => {
	if (m.dimmed === dimmed) return m;
	const core = Model.coreOf(m);
	if (core) return new Model(core, dimmed);
	// Another implementation: the same object seen through a prototype, with `dimmed` replaced.
	return Object.create(m, { dimmed: { value: dimmed, enumerable: true } }) as LoadModel;
};

/** The leaf people a row's minutes sum, for the cell details and tests. */
export function rowMembers(m: LoadModel, row: number): readonly ResourceId[] {
	const core = Model.coreOf(m);
	if (core) return core.members[row] ?? [];
	const r = m.rows[row];
	return r && !r.group ? [r.id] : [];
}

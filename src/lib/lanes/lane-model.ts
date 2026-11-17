// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The lanes' model (phase-3.md 9.4): what the Resources lanes draw, made from the heatmap's load
 * model (its rows, and its bands at the lanes' bucket, so "over" is the one rule), the people's
 * availability (bookings per task, leave by type) and the symbol index (which tasks the text lets
 * a drag move). Display data (ADR-0007, ADR-0014 #4): it reads the engine's intervals and never
 * schedules.
 *
 * - **Rows** are the load model's: one lane per leaf person and a group's row above its members,
 *   where the roll-up is drawn as a thin band (its bands are the model's group sums).
 * - **Runs** (`runs(row)`): the person's bars, merged per task per day (lane-runs.ts). A bar is
 *   `movable` when the text can move its task (a drag starts only there), and `textOnly` when the
 *   index says the task is declared where the editor cannot edit (it shows the badge).
 * - **Leave** (`leaves(row)`): hatched blocks by type, from the engine's per-type leave slots plus,
 *   as the heatmap's hatch does, the working time lost where two global leaves overlap (shown as
 *   `holiday`: the engine gives that time no type).
 * - Runs and leave are made on first ask, per person, and kept with the model: a lane that never
 *   scrolls into view costs nothing. The view warms the rows of its window (`warm`) when a model is
 *   built and as rows come into view, outside the paint frame.
 */
import type { EngineLeaveType } from '../../engine/protocol';
import type { ResourceId, SymbolIndex, TaskId } from '../tjp/index';
import type { ZoneOffsets } from '../tjp/values/civil';
import { allLeave, globalLeaveOverlaps, overlapLeaveOf } from '../workload/availability';
import { bucketAxis } from '../workload/axis';
import { movableTask } from '../workload/load';
import { union } from '../workload/intervals';
import type {
	Availability,
	BucketAxis,
	IntervalSet,
	LoadModel,
	PersonAvailability,
} from '../workload/types';
import type { ProjectInfo, ScheduleResult } from '../../engine/protocol';
import { laneRuns, leaveRuns, type LaneRun, type LeaveRun } from './lane-runs';

/** A bar as the lane draws and hits it. */
export interface LaneBar extends LaneRun {
	/** The text lets a drag move the task (W1, W2). */
	readonly movable: boolean;
	/** The task is declared where the editor cannot edit it: the bar shows the badge. */
	readonly textOnly: boolean;
}

export interface LaneLeave {
	readonly type: EngineLeaveType;
	readonly runs: readonly LeaveRun[];
}

export interface LanesInput {
	/** The load model at the lanes' bucket. */
	readonly load: LoadModel;
	readonly availability: Availability;
	/** The newest good result: its tasks give the names the lanes write on bars. */
	readonly result: ScheduleResult;
	readonly project: ProjectInfo;
	readonly index: SymbolIndex;
	readonly zones: ZoneOffsets;
}

export class LanesModel {
	readonly load: LoadModel;
	readonly #i: LanesInput;
	readonly #days: BucketAxis;
	readonly #overlaps;
	readonly #runs = new Map<ResourceId, readonly LaneBar[]>();
	readonly #leaves = new Map<ResourceId, readonly LaneLeave[]>();
	readonly #lostOf = new Map<ResourceId, IntervalSet>();
	#types: readonly EngineLeaveType[] | null = null;
	readonly #names: ReadonlyMap<TaskId, string>;

	constructor(i: LanesInput) {
		this.load = i.load;
		this.#i = i;
		this.#days = bucketAxis(i.project, i.zones, 'day');
		this.#overlaps = globalLeaveOverlaps(i.project);
		this.#names = new Map(i.result.tasks.map((t) => [t.id, t.name]));
	}

	#person(row: number): PersonAvailability | undefined {
		const r = this.load.rows[row];
		return r && !r.group ? this.#i.availability.people.get(r.id) : undefined;
	}

	/**
	 * The working time a person loses where two global leaves overlap (drawn as `holiday`, see
	 * `leaves`), once per person: the engine puts it in neither `working` nor `leave`.
	 */
	#lost(id: ResourceId, p: PersonAvailability): IntervalSet {
		if (this.#overlaps.length === 0) return [];
		let lost = this.#lostOf.get(id);
		if (!lost) {
			lost = overlapLeaveOf(this.#i.project, this.#i.zones, p, this.#overlaps);
			this.#lostOf.set(id, lost);
		}
		return lost;
	}

	/** The bars of a lane, by start; none for a group's row or a person the result does not know. */
	runs(row: number): readonly LaneBar[] {
		const r = this.load.rows[row];
		const p = this.#person(row);
		if (!r || !p) return [];
		let list = this.#runs.get(r.id);
		if (!list) {
			// What a bar must not run across: working time, leave, and the time lost to overlapping
			// global leaves (which the lane draws as a holiday block).
			const hours = union(union(p.working, allLeave(p)), this.#lost(r.id, p));
			const index = this.#i.index;
			list = laneRuns(p.tasks, p.booked, hours, this.#days.bounds).map((run) => ({
				...run,
				movable: movableTask(index, run.task),
				textOnly: this.isTextOnly(run.task),
			}));
			this.#runs.set(r.id, list);
		}
		return list;
	}

	/** The hatched blocks of a lane, by type. */
	leaves(row: number): readonly LaneLeave[] {
		const r = this.load.rows[row];
		const p = this.#person(row);
		if (!r || !p) return [];
		let list = this.#leaves.get(r.id);
		if (!list) {
			const out: LaneLeave[] = [];
			for (const l of p.leave) {
				const runs = leaveRuns(l.intervals, p.working);
				if (runs.length > 0) out.push({ type: l.type, runs });
			}
			const lost = this.#lost(r.id, p);
			if (lost.length > 0) out.push({ type: 'holiday', runs: leaveRuns(lost, p.working) });
			this.#leaves.set(r.id, (list = out));
		}
		return list;
	}

	/**
	 * Makes the bars and leave of the rows [first, last) now, so that a painter, which asks for them
	 * in a frame, only reads (phase-3.md 8.1, 8.3). The view calls it when a model is built and when
	 * rows come into its window, outside the paint.
	 */
	warm(first: number, last: number): void {
		const to = Math.min(last, this.load.rows.length);
		for (let r = Math.max(0, first); r < to; r++) {
			this.runs(r);
			this.leaves(r);
		}
	}

	/** The leave types any person has, in `EngineLeaveType` order (the legend's swatches). */
	leaveTypes(): readonly EngineLeaveType[] {
		if (!this.#types) {
			const seen = new Set<EngineLeaveType>();
			for (const p of this.#i.availability.people.values()) {
				for (const l of p.leave) if (l.intervals.length > 0) seen.add(l.type);
			}
			if (this.#overlaps.length > 0) seen.add('holiday');
			this.#types = LEAVE_ORDER.filter((t) => seen.has(t));
		}
		return this.#types;
	}

	/** The task of a bar, for a name. */
	taskName(id: TaskId): string {
		return this.#names.get(id) ?? this.#i.index.tasks.get(id)?.name ?? id;
	}

	/** Whether the text declares the task where the editor cannot edit it (the badge). */
	isTextOnly(id: TaskId): boolean {
		const sym = this.#i.index.tasks.get(id);
		return sym !== undefined && (sym.textOnly !== null || sym.expandedOnly);
	}
}

const LEAVE_ORDER: readonly EngineLeaveType[] = [
	'project',
	'annual',
	'special',
	'sick',
	'unpaid',
	'holiday',
	'unemployed',
];

export function buildLanes(i: LanesInput): LanesModel {
	return new LanesModel(i);
}

/**
 * The bar under a content x on a lane, within `slop` px of its ends (so a bar a few pixels wide can
 * be hit), or null. `xOf` maps a minute to a content x; the runs are ordered by start, and a lane
 * has no overlapping bars, so one binary search finds the candidate.
 */
export function barAt(
	runs: readonly LaneBar[],
	xOf: (m: number) => number,
	x: number,
	minWidth: number,
	slop: number,
): LaneBar | null {
	let lo = 0;
	let hi = runs.length - 1;
	// The last bar that starts at or before x + slop.
	let at = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (xOf((runs[mid] as LaneBar).from) <= x + slop) {
			at = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	// A bar can end after the next one starts only by the minimum width, so look one back as well.
	// A point inside a bar wins over one near another bar's end.
	let best: LaneBar | null = null;
	let bestGap = Infinity;
	for (let k = at; k >= 0 && k >= at - 1; k--) {
		const b = runs[k] as LaneBar;
		const x0 = xOf(b.from);
		const x1 = Math.max(xOf(b.to), x0 + minWidth);
		const gap = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
		if (gap <= slop && gap < bestGap) {
			best = b;
			bestGap = gap;
		}
	}
	return best;
}

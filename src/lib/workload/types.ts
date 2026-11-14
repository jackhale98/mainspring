// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Workload model types (phase-3.md 6.2; ADR-0014 #2, #3). The interface between T9 (axis.ts,
 * availability.ts, load.ts, bands.ts) and its consumers: the explainer and demand (T10), the
 * rebalance planner (T12) and the People views (T13 to T15). Types and contracts only: the code
 * is T9's, and it implements the function types below (`BucketAxisFn`, `AvailabilityFn`,
 * `BuildLoadFn`, `WithDimmedFn`).
 *
 * ## Contract
 *
 * - **Display data** (ADR-0007, extended by ADR-0014 #4). Everything here is a pure function of
 *   one `ScheduleResult` and the symbol index. It is never sent to the engine, never becomes a
 *   task's date, and is never shown as a date the engine produced.
 * - **Exact sums.** Times are integer `Minutes` since `ProjectInfo.start`. Booked, available and
 *   leave minutes are sums of engine intervals (`bookings`, v3 `ResourceScenarioResult.workingTime`
 *   and `leaves`), not estimates; the gate checks them (phase-3.md 16.1). Load is derived from
 *   `bookings`; the engine has no load field (ADR-0014 #2).
 * - **Hours are booked time**, not weighted by efficiency (18.2, ADR-0014 #2). The cell details
 *   show the effective effort (booked x efficiency) beside them.
 * - **Groups** are the sums of their leaf members, per bucket. The engine gives groups no working
 *   time or leaves of their own (protocol.ts, `ResourceScenarioResult`).
 * - **Held and unmet minutes** (6.3 `DemandMarks`) are each entry's window intersected with the
 *   person's `workingTime`, summed over the entries in the bucket. A task may have several
 *   entries per person, one per disjoint window.
 * - **No preview recomputes load.** A rebalance drop shows a pending ghost; the numbers change only
 *   when the engine's result arrives (5.2).
 * - **Dimming costs no rebuild.** `buildLoad` returns `dimmed: false`. When `RunnerState.outdated`
 *   changes and the result does not, `withDimmed` re-wraps the existing model.
 * - **Scenario.** Every view draws the first active scenario, as the Gantt does (phase-3.md 2).
 * - **Cost.** `buildLoad` runs once per result in an idle task, after the Gantt's analysis: at most
 *   15 ms on desktop for `fedora-res` and `syn-20-scale-1000`, and no task over 50 ms at 4x CPU
 *   (chunked by rows).
 * - **Band rule** (`LoadModel.band`, ADR-0014 #3, 18.3), with u = 100 x booked / available,
 *   evaluated in order, first match wins:
 *   1. `off`: available and booked are both 0. This holds even when work is held or unmet for the
 *      person in the bucket (a person on leave all week whom a task waits for); those entries
 *      still appear in the cell's details (`LoadModel.cellTasks`);
 *   2. `over`: booked > available, held > 0, unmet > 0, or u > `overAbove`;
 *   3. `spare`: u < `spareBelow`;
 *   4. `full`: everything else.
 */
// T2: the order of the band rules and the `off` case with held or unmet work are the main
// session's ruling at the T2 review (2026-11-14); 6.2 lists the rules without an order.
import type {
	EngineLeaveType,
	Minutes,
	ProjectInfo,
	Revision,
	ScheduleResult,
} from '../../engine/protocol';
import type { DemandMarks } from '../schedule/explain-types';
import type { ResourceId, SymbolIndex, TaskId, TextOnlyReason } from '../tjp/index';
import type { ZoneOffsets } from '../tjp/values/civil';

export type BucketKind = 'day' | 'week' | 'month';

/**
 * The heatmap's columns: local days, weeks or months of the plan's time zone over the project
 * frame. Weeks start on Monday or Sunday by v3 `ProjectInfo.weekStartsMonday`, so week buckets
 * match TaskJuggler's weekly report (the cross-check, 5.3).
 */
export interface BucketAxis {
	readonly kind: BucketKind;
	/**
	 * Local-midnight starts in the project zone (DST-correct, via ZoneOffsets), plus the frame end:
	 * length `count + 1`, ascending. Bucket i is [bounds[i], bounds[i + 1]).
	 */
	// T2: every start is read as a local midnight (a day, week or month start), the first one
	// included, so bounds[0] is at or before 0 when the frame starts mid-bucket. Only the last
	// bound is the frame end. The first bucket's sums cover the frame part only (no engine
	// intervals lie before 0).
	readonly bounds: Int32Array;
	readonly count: number;
	/** The bucket holding the minute [m, m + 1); -1 outside the frame [0, frame end). */
	indexOf(m: Minutes): number;
}

/** axis.ts (T9): `export const bucketAxis: BucketAxisFn`. */
export type BucketAxisFn = (p: ProjectInfo, zones: ZoneOffsets, kind: BucketKind) => BucketAxis;

/** Percent of available time. Adjustable in the Workload toolbar, stored per plan (18.3). */
export interface Thresholds {
	spareBelow: number;
	overAbove: number;
}

/** 18.3: spare below 80 %, over above 100 %. */
export const DEFAULT_THRESHOLDS: Readonly<Thresholds> = Object.freeze({
	spareBelow: 80,
	overAbove: 100,
});

export type Band = 'off' | 'spare' | 'full' | 'over';

/** One heatmap row: a person or a group, from the symbol index (the text is the source). */
export interface LoadRow {
	readonly id: ResourceId;
	readonly name: string;
	/** 0 for a root resource. */
	readonly depth: number;
	readonly group: boolean;
	/** For a group, whether its members are shown (not in `collapsed`); null for a person. */
	readonly expanded: boolean | null;
	/** Why the resource's declaration is text-only (its edits are refused), or null. */
	readonly textOnly: TextOnlyReason | null;
}

/** One task of a cell (`LoadModel.cellTasks`). */
export interface CellTask {
	readonly task: TaskId;
	/**
	 * `booked`: the task's booked minutes in the cell. `held` and `unmet`: the sum over the task's
	 * windows for the person (`DemandEntry`; a task may have several, disjoint) of each window
	 * intersected with the person's `workingTime` and the cell. That is 0 in an `off` cell, where
	 * the task is listed all the same. One entry per task and kind.
	 */
	// T2: 6.2 gave `minutes` no meaning for held and unmet entries; the meaning above is the main
	// session's ruling at the T2 review (2026-11-14).
	readonly minutes: number;
	readonly kind: 'booked' | 'held' | 'unmet';
	/** Whether a rebalance drag (W1, W2) may start from it. Always false on a group row. */
	readonly movable: boolean;
}

export interface LoadModel {
	readonly revision: Revision;
	readonly scenario: string;
	readonly axis: BucketAxis;
	/** Pre-order, collapse applied. */
	readonly rows: readonly LoadRow[];
	/** Per row, per bucket, integer minutes. Groups are the sums of their leaf members. */
	readonly booked: readonly Int32Array[];
	readonly available: readonly Int32Array[];
	/**
	 * Working time lost to leave, for the hatch: the sum of v3 `ResourceScenarioResult.leaves` in
	 * the bucket (leave slots in working hours only, so it is exact and disjoint from `available`).
	 */
	readonly leave: readonly Int32Array[];
	/**
	 * Held minutes from `DemandMarks` (6.3): each held entry's window intersected with the person's
	 * `workingTime` and the bucket, summed. Zeros while there is no demand.
	 */
	readonly held: readonly Int32Array[];
	/** Unmet minutes from `DemandMarks`, computed as `held` is. Zeros while there is no demand. */
	readonly unmet: readonly Int32Array[];
	/** The band of a cell under the thresholds: the band rule, in order, first match wins. */
	band(row: number, col: number, t: Thresholds): Band;
	/**
	 * The cell's tasks, computed on demand: booked minutes per task, then the held and unmet
	 * entries whose window overlaps the bucket. These are listed in an `off` cell too, where their
	 * minutes are 0. A group row lists its members' tasks, none of them movable.
	 */
	cellTasks(row: number, col: number): readonly CellTask[];
	/** `RunnerState.outdated`: the newest outcome is not the result drawn. Set by `withDimmed`. */
	readonly dimmed: boolean;
}

/** What `buildLoad` reads. */
export interface LoadInput {
	result: ScheduleResult;
	index: SymbolIndex;
	zones: ZoneOffsets;
	kind: BucketKind;
	/** Groups whose members are hidden. */
	collapsed: ReadonlySet<ResourceId>;
	/** `availabilityOf(result, scenario)`, made once per result and shared with the explainer. */
	availability: Availability;
	/** Null until demand is computed (6.3): `held` and `unmet` are zeros. */
	demand: DemandMarks | null;
}

/** load.ts (T9): `export const buildLoad: BuildLoadFn`. The model it returns is not dimmed. */
export type BuildLoadFn = (i: LoadInput) => LoadModel;

/**
 * load.ts (T9): `export const withDimmed: WithDimmedFn`. The same model with `dimmed` set: every
 * array and the axis are shared, nothing is recomputed. The view calls it when
 * `RunnerState.outdated` changes and the result does not.
 */
// T2: the main session's ruling at the T2 review (2026-11-14): dimming must not cost a rebuild,
// so `LoadInput` takes no runner state and the model is re-wrapped.
export type WithDimmedFn = (m: LoadModel, dimmed: boolean) => LoadModel;

/** Interval list: [start, end) pairs, ascending, disjoint, touching pairs merged. */
export type IntervalSet = ReadonlyArray<readonly [start: Minutes, end: Minutes]>;

// T2: 6.3's `ExplainContext` names `Availability`, which 6.2 does not define. Section 4 gives
// availability.ts as "per person: working time, leave, booked, free, as interval sets"; the types
// below are that and nothing more. T9 may add members.
/** One person's time in one scenario (availability.ts, T9). */
export interface PersonAvailability {
	/** v3 `ResourceScenarioResult.workingTime`: slots they could work, free or booked. */
	readonly working: IntervalSet;
	/** v3 `ResourceScenarioResult.leaves`: working time lost to leave, by type. */
	readonly leave: ReadonlyArray<{
		readonly type: EngineLeaveType;
		readonly intervals: IntervalSet;
	}>;
	/** Their bookings on every task (`bookings`), merged. */
	readonly booked: IntervalSet;
	/** `working` minus `booked` (6.3 rule 2). */
	readonly free: IntervalSet;
}

/** Every leaf person's availability in one scenario of one result. */
export interface Availability {
	readonly revision: Revision;
	readonly scenario: string;
	/** Leaf resources only (groups have no time of their own). */
	readonly people: ReadonlyMap<ResourceId, PersonAvailability>;
}

/**
 * availability.ts (T9): `export const availabilityOf: AvailabilityFn`. Made once per result; the
 * load model (`LoadInput.availability`) and the explainer (`ExplainContext.availability`) share
 * it.
 */
export type AvailabilityFn = (result: ScheduleResult, scenario: string) => Availability;

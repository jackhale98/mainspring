// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Workload model types (phase-3.md 6.2; ADR-0014). The interface between T9 (axis.ts,
 * availability.ts, load.ts, bands.ts) and its consumers: the explainer and demand (T10), the
 * rebalance planner (T12) and the People views (T13 to T15). Types and contracts only: the code
 * is T9's, and it implements the function types below (`BucketAxisFn`, `BuildLoadFn`).
 *
 * ## Contract
 *
 * - **Display data** (ADR-0007, extended by ADR-0014 #4). Everything here is a pure function of
 *   one `ScheduleResult` and the symbol index. It is never sent to the engine, never becomes a
 *   task's date, and is never shown as a date the engine produced.
 * - **Exact sums.** Times are integer `Minutes` since `ProjectInfo.start`. Booked and available
 *   minutes are sums of engine intervals (`bookings`, v3 `ResourceScenarioResult.workingTime`),
 *   not estimates; the gate checks them (phase-3.md 16.1). Load is derived from `bookings`; the
 *   engine has no load field (ADR-0014 #2).
 * - **Hours are booked time**, not weighted by efficiency (18.2). The cell details show the
 *   effective effort (booked x efficiency) beside them.
 * - **Groups** are the sums of their leaf members, per bucket. The engine gives groups no working
 *   time or leaves of their own (protocol.ts, `ResourceScenarioResult`).
 * - **No preview recomputes load.** A rebalance drop shows a pending ghost; the numbers change only
 *   when the engine's result arrives (5.2).
 * - **Scenario.** Every view draws the first active scenario, as the Gantt does (phase-3.md 2).
 * - **Cost.** `buildLoad` runs once per result in an idle task, after the Gantt's analysis: at most
 *   15 ms on desktop for `fedora-res` and `syn-20-scale-1000`, and no task over 50 ms at 4x CPU
 *   (chunked by rows).
 * - **Band rule** (`LoadModel.band`, ADR-0014 #3, 18.3), with u = 100 x booked / available:
 *   - `off`: available and booked are both 0;
 *   - `over`: booked > available, held > 0, unmet > 0, or u > `overAbove`;
 *   - `spare`: u < `spareBelow`;
 *   - `full`: everything else.
 */
// T2: 6.2 does not say which band wins when a bucket has no available and no booked time but held
// or unmet work (a person on leave all week whom a task waits for). The rules are read in the
// order written, first match wins, so that bucket is `off`. Flagged in the T2 report for T9.
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
	// T2: 6.2 gives `minutes` no meaning for held and unmet entries. Read as: booked minutes of the
	// task in the cell (`booked`), else the minutes of its held or unmet window inside the cell.
	readonly minutes: number;
	readonly kind: 'booked' | 'held' | 'unmet';
	/** Whether a rebalance drag (W1, W2) may start from it. */
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
	/** Leave minutes on working days, for the hatch. */
	readonly leave: readonly Int32Array[];
	/** Held minutes, from `DemandMarks` (6.3); zeros while there are none. */
	readonly held: readonly Int32Array[];
	/** Unmet minutes, from `DemandMarks` (6.3); zeros while there are none. */
	readonly unmet: readonly Int32Array[];
	/** The band of a cell under the thresholds (module comment). */
	band(row: number, col: number, t: Thresholds): Band;
	/** The cell's tasks: booked minutes per task, then held or unmet tasks. Computed on demand. */
	cellTasks(row: number, col: number): readonly CellTask[];
	/** `RunnerState.outdated`: the newest outcome is not the result drawn. */
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
	/** Null until demand is computed (6.3): `held` and `unmet` are zeros. */
	demand: DemandMarks | null;
	// T2: 6.2's input has nothing `LoadModel.dimmed` could come from. The smallest addition is the
	// runner's own flag, copied as it is.
	/** `RunnerState.outdated` for `result`. */
	outdated: boolean;
}

/** load.ts (T9): `export const buildLoad: BuildLoadFn`. */
export type BuildLoadFn = (i: LoadInput) => LoadModel;

/** Interval list: [start, end) pairs, ascending, disjoint, touching pairs merged. */
export type IntervalSet = ReadonlyArray<readonly [start: Minutes, end: Minutes]>;

// T2: 6.3's `ExplainContext` names `Availability`, which 6.2 does not define. Section 4 gives
// availability.ts as "per person: working time, leave, booked, free, as interval sets"; the types
// below are that and nothing more. T9 may add members.
/** One person's time in one scenario (availability.ts, T9). */
export interface PersonAvailability {
	/** v3 `ResourceScenarioResult.workingTime`: slots they could work, free or booked. */
	readonly working: IntervalSet;
	/** v3 `ResourceScenarioResult.leaves`: leave slots by type. */
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

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Types of the explainer and demand (phase-3.md 6.3, 5.4; ADR-0014): why a task starts (ASAP) or
 * ends (ALAP) where it does, why its bar has gaps, and which work is held or unmet. The interface
 * between T10 (explain.ts, demand.ts) and its consumers: the load model (T9), health (T11) and
 * "Why is this here?" (T18). Types and contracts only: T10 implements `ExplainTaskFn` and
 * `DemandOfFn`.
 *
 * ## Contract
 *
 * - **Display data** (ADR-0007, extended by ADR-0014 #4). Pure functions of one result, its driving
 *   analysis and the index. The output is never sent to the engine and never becomes a date.
 * - **Interpretations, labelled.** Causes and held or unmet work are read from the schedule, and
 *   the UI says so ("about" where minutes are estimated). When the explainer cannot tell, it says
 *   `unknown`. `limit` means "may hold it": limits are not engine data until Phase 5 (18.13).
 * - **Cost.** `explainTask` on demand, at most 5 ms. `demandOf` for all tasks, in an idle task.
 * - **Property** (13.1): the causes partition the window between `bound` and `at` (`[bound, at)`
 *   for ASAP, `[at, bound)` for ALAP) and never extend outside it.
 *
 * ## Rules (T10; checked against hand-computed fixtures)
 *
 * 1. `bound` uses Phase 2's `earliestUnder` and `latestEnd` over the resolved edges, the frame,
 *    and a written `start` or `minstart` (`end` or `maxend` for ALAP). When `at` equals `bound`,
 *    the binding item is the cause: a dependency is `dependency`, the frame is `frame`, a written
 *    date is `constraint`.
 * 2. When `at` is later than `bound`, look at `[bound, at)` for each person in the task's v3
 *    `allocate`; a group candidate counts as its leaf members. Their free time is their working
 *    time minus all their bookings (`PersonAvailability.free`).
 *    - If no candidate had free time in the window, the window is split into `busy`, `leave` and
 *      `off-hours` causes per person, from the engine intervals, and the task is **held** for
 *      those people. v3 `leaves` holds working-hours slots only, so the nights and weekends
 *      inside a leave read as `off-hours`.
 *    - If a candidate had free time, the cause is `limit` when a `limits` statement is on the task
 *      or on that person in the text, else `unknown`.
 * 3. **Unmet:** for a `length` or `duration` leaf, the parts of `[start, end)` where an `allocate`
 *    candidate had working time but was booked on another task.
 * 4. **Inside:** for an effort leaf, the gaps between its bookings inside `[start, end)`, explained
 *    the same way.
 * 5. The explainer never says "would have started on …". It names what the schedule shows.
 */
// T2: rule 2 says "later than `bound`", which is the ASAP case. For ALAP (`anchor: 'end'`) it is
// read mirrored: the window is `[at, bound)` when `at` is earlier than `bound`.
import type { EngineLeaveType, Minutes, ScheduleResult } from '../../engine/protocol';
import type { ResourceId, SourceRange, SymbolIndex, TaskId } from '../tjp/index';
import type { Availability } from '../workload/types';
import type { DrivingAnalysis } from './critical';
import type { WorkingTime } from './working-time';

export type Cause =
	| { kind: 'dependency'; pred: TaskId; via: 'depends' | 'precedes'; gap: boolean }
	| { kind: 'frame' }
	| { kind: 'constraint'; attr: 'start' | 'minstart' | 'end' | 'maxend'; inherited: boolean }
	| {
			kind: 'busy';
			resource: ResourceId;
			window: [Minutes, Minutes];
			/** The tasks the person was booked on in the window, and for how many minutes. */
			on: ReadonlyArray<{ task: TaskId; minutes: number }>;
	  }
	// T2: 6.3 does not say what a null `resource` means on `leave` and `off-hours`. Read as: the
	// cause is the project's own calendar (a global leave, or global off hours), not one person's.
	| {
			kind: 'leave';
			resource: ResourceId | null;
			type: EngineLeaveType;
			window: [Minutes, Minutes];
	  }
	| { kind: 'off-hours'; resource: ResourceId | null; window: [Minutes, Minutes] }
	/** A `limits` statement on the task or its people: "may" hold it. */
	| { kind: 'limit'; site: SourceRange }
	/** The schedule does not show why. */
	| { kind: 'unknown' };

export type CauseKind = Cause['kind'];

export interface Placement {
	readonly task: TaskId;
	/** `start` for an ASAP task, `end` for an ALAP one. */
	readonly anchor: 'start' | 'end';
	/**
	 * The earliest start (ASAP) or latest end (ALAP) that dependencies, frame and constraints
	 * allow; null when the result does not give one.
	 */
	readonly bound: Minutes | null;
	/** Where the engine put the anchor; null when the task has no date in the result. */
	readonly at: Minutes | null;
	/** Why `at` differs from `bound` (or what binds it when equal), in time order. */
	readonly causes: readonly Cause[];
	/** Gaps inside the bar (effort tasks): busy, leave, off hours. */
	readonly inside: readonly Cause[];
}

/** One task held or unmet for a person, over one window. */
export interface DemandEntry {
	readonly task: TaskId;
	/**
	 * [start, end) as read from the schedule (rules 2 and 3). The held or unmet minutes are this
	 * window intersected with the person's `workingTime`. A task has one entry per disjoint window,
	 * so it may have several per person.
	 */
	readonly window: [Minutes, Minutes];
}

/**
 * Held and unmet work per person (5.4), for the load model's `held` and `unmet` and for H7, H8.
 * Keyed by leaf person: a group candidate in a task's `allocate` is expanded to its leaf members.
 */
export interface DemandMarks {
	/** Effort tasks that wait while every person they asked for is booked elsewhere or on leave. */
	readonly held: ReadonlyMap<ResourceId, ReadonlyArray<DemandEntry>>;
	/** `length` and `duration` tasks that run while a person they asked for is booked elsewhere. */
	readonly unmet: ReadonlyMap<ResourceId, ReadonlyArray<DemandEntry>>;
}

export interface ExplainContext {
	result: ScheduleResult;
	scenario: string;
	index: SymbolIndex;
	analysis: DrivingAnalysis;
	wt: WorkingTime;
	availability: Availability;
}

/** explain.ts (T10): `export const explainTask: ExplainTaskFn`. On demand, at most 5 ms. */
export type ExplainTaskFn = (id: TaskId, ctx: ExplainContext) => Placement;

/** demand.ts (T10): `export const demandOf: DemandOfFn`. All tasks, in an idle task. */
export type DemandOfFn = (ctx: ExplainContext) => DemandMarks;

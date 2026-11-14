// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Plan health types (phase-3.md 6.4, section 12; ADR-0014 #6). The interface between T11 (the
 * checks, report.ts, settings.ts) and the health panel and its phone path (T18). Types, contracts
 * and the default settings only: T11 implements `CheckPlanFn`.
 *
 * ## Contract
 *
 * - **Display data** (ADR-0007, extended by ADR-0014 #4). `checkPlan` is pure over the index, one
 *   result, its driving analysis and demand. Findings are never sent to the engine.
 * - **Checks** (section 12; ids in `CheckId` order): H1 `no-predecessor`, H2 `no-successor`, H3
 *   `hard-constraint`, H4 `constraint-warning`, H5 `long-gap`, H6 `long-task`, H7
 *   `held-by-people`, H8 `work-without-people`, H9 `resource-warning`. Leaves and milestones are
 *   checked; containers are not checked themselves. Text-only tasks are reported, and their fixes
 *   are disabled with the reason.
 * - **Fixes** go through the edit dispatcher (`intent`) or open a place in the UI. A fix never
 *   edits the text by itself.
 * - **Sentences** live in strings.ts (`healthStrings`), keyed by check. Settings are UI preferences
 *   per plan (ADR-0008 #3), kept by settings.ts.
 */
// T2: 6.4 gives `Finding` no data for its sentence beyond the subject ("Waits 6 working days for
// Dev 1 (booked on Build API)" needs days, a person and a task). Nothing is added here: T11 either
// reads the facts again from `DemandMarks` and the result, or adds a member (members may be
// added; existing ones stay).
import type { Minutes, Revision, ScheduleResult } from '../../engine/protocol';
import type { DrivingAnalysis } from '../schedule/critical';
import type { DemandMarks } from '../schedule/explain-types';
import type { WorkingTime } from '../schedule/working-time';
import type { EditIntent } from '../tjp/edit/types';
import type { ResourceId, SourceRange, SymbolIndex, TaskId } from '../tjp/index';

export type CheckId =
	| 'no-predecessor'
	| 'no-successor'
	| 'hard-constraint'
	| 'constraint-warning'
	| 'long-gap'
	| 'long-task'
	| 'held-by-people'
	| 'work-without-people'
	| 'resource-warning';

/** What a finding is about. `message` is an index into `ScheduleResult.messages` (H4, H9). */
export type Subject =
	| { kind: 'task'; id: TaskId }
	| { kind: 'link'; pred: TaskId; succ: TaskId }
	| { kind: 'message'; index: number };

export type Fix =
	/** An edit, through `app.edits.dispatch`: one undo step. */
	| { kind: 'intent'; label: string; intent: EditIntent }
	/** The dependency picker (polish item 11), for H1 and H2. */
	| { kind: 'pick'; role: 'predecessor' | 'successor'; task: TaskId }
	/** The allocation chip's "Replace with…". */
	| { kind: 'replace-person'; task: TaskId; from: ResourceId }
	| { kind: 'open'; view: 'workload' | 'calendar'; resource: ResourceId; at: Minutes }
	/** "Why here?" in the task's details. */
	| { kind: 'why'; task: TaskId }
	/** "Show in text": the finding's `at`. */
	| { kind: 'show' };

export type Severity = 'info' | 'warning' | 'error';

export interface Finding {
	readonly check: CheckId;
	readonly severity: Severity;
	readonly subject: Subject;
	/** Where it is in the text (the message's line for H4 and H9), or null. */
	readonly at: SourceRange | null;
	readonly fixes: readonly Fix[];
}

export interface HealthSettings {
	/** H5: a gap over this many working days (calendar days at the gap's rate for `gapduration`). */
	longGapDays: number;
	/** H6: a leaf whose engine span has more working days than this. */
	longTaskDays: number;
	/** Checks turned off per plan are false. */
	enabled: Readonly<Record<CheckId, boolean>>;
}

// T2: 6.4 and 18.8 give the two thresholds (5, 20) and say checks "can be turned off per plan".
// Read as: every check is on by default.
/** 18.8: long gap 5 working days, long task 20 working days, every check on. */
export const DEFAULT_HEALTH_SETTINGS: Readonly<HealthSettings> = Object.freeze({
	longGapDays: 5,
	longTaskDays: 20,
	enabled: Object.freeze({
		'no-predecessor': true,
		'no-successor': true,
		'hard-constraint': true,
		'constraint-warning': true,
		'long-gap': true,
		'long-task': true,
		'held-by-people': true,
		'work-without-people': true,
		'resource-warning': true,
	} satisfies Record<CheckId, boolean>),
});

export interface HealthReport {
	readonly revision: Revision;
	readonly findings: readonly Finding[];
	/** Findings per check; 0 for a check with none or turned off. */
	readonly counts: Readonly<Record<CheckId, number>>;
}

/** What `checkPlan` reads. */
export interface HealthInput {
	index: SymbolIndex;
	result: ScheduleResult;
	analysis: DrivingAnalysis;
	demand: DemandMarks;
	wt: WorkingTime;
	settings: HealthSettings;
}

/** T11's `checkPlan` has this type (`export const checkPlan: CheckPlanFn`). */
export type CheckPlanFn = (i: HealthInput) => HealthReport;

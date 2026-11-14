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
// T2: `Finding.facts` and `Fix.disabled` are the main session's ruling at the T2 review
// (2026-11-14): 6.4's `Finding` had no data for its sentence, and section 12 disables the fixes of
// text-only tasks. `facts` holds only what section 12's sentences and fix labels name.
import type { Minutes, Revision, ScheduleResult } from '../../engine/protocol';
import type { DrivingAnalysis } from '../schedule/critical';
import type { DemandMarks } from '../schedule/explain-types';
import type { WorkingTime } from '../schedule/working-time';
import type { EditIntent } from '../tjp/edit/types';
import type { ResourceId, SourceRange, SymbolIndex, TaskId, TextOnlyReason } from '../tjp/index';

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

/** What a fix does. */
export type FixAction =
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

/**
 * A fix and whether it can run. `disabled` is the text-only reason of the text the fix would edit
 * (section 12: text-only tasks are reported, and their fixes are disabled with the reason), the
 * same reason the edit API refuses such an edit with (`Refused.textOnly`). Null when it can run,
 * and always null for the fixes that only open a place (`open`, `why`, `show`).
 */
export type Fix = FixAction & { readonly disabled: TextOnlyReason | null };

export type Severity = 'info' | 'warning' | 'error';

/** H9's TaskJuggler messages (section 12). */
export type ResourceWarningId =
	| 'allocate_no_assigned'
	| 'priority_inversion'
	| 'overbooked_effort'
	| 'overbooked_length'
	| 'overbooked_duration';

/** What each check's sentence and fix labels name (section 12), by check. */
export interface CheckFacts {
	'no-predecessor': null;
	'no-successor': null;
	/** "Remove" shows the date the constraint held. */
	'hard-constraint': {
		readonly attr: 'start' | 'end' | 'minstart' | 'maxend';
		readonly date: Minutes;
	};
	/** "Starts 3 days after its latest allowed start": which limit, by how much; the message text. */
	'constraint-warning': {
		readonly limit: 'minstart' | 'maxstart' | 'minend' | 'maxend';
		readonly days: number;
		readonly text: string;
	};
	/** Working days for `gaplength`; calendar days at the gap's own rate for `gapduration`. */
	'long-gap': { readonly gap: 'gaplength' | 'gapduration'; readonly days: number };
	/** Working days of the leaf's engine span. */
	'long-task': { readonly days: number };
	/**
	 * "Waits 6 working days for Dev 1 (booked on Build API)": the person, the working days the task
	 * waits for them, and the task they were booked on (null when they were not booked: leave or
	 * off hours only).
	 */
	'held-by-people': {
		readonly resource: ResourceId;
		readonly days: number;
		readonly on: TaskId | null;
	};
	/** Ran without a person it asked for, "for N hours": the person, and the unmet minutes. */
	'work-without-people': { readonly resource: ResourceId; readonly minutes: number };
	/**
	 * Each message has its own sentence. `tasks` are the tasks of `priority_inversion`'s info lines
	 * (the lower-priority tasks that took the people); [] for the other messages.
	 */
	'resource-warning': {
		readonly message: ResourceWarningId;
		readonly text: string;
		readonly tasks: readonly TaskId[];
	};
}
// T2: readings within the ruling. H4's `days` are working days, as H6 and H7 count them. H7 and
// H8 make one finding per task and person; H7's `on` is the task the person was booked on for
// most of the held windows. H8 keeps integer minutes, as the load model does; the sentence prints
// hours.

/** One finding of check `C`: `facts` narrows with `check`. */
export interface FindingOf<C extends CheckId> {
	readonly check: C;
	readonly severity: Severity;
	readonly subject: Subject;
	/** Where it is in the text (the message's line for H4 and H9), or null. */
	readonly at: SourceRange | null;
	readonly fixes: readonly Fix[];
	readonly facts: CheckFacts[C];
}

export type Finding = { [C in CheckId]: FindingOf<C> }[CheckId];

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

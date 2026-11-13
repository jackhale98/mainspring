// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Gantt actions to edit intents (phase-2.md 6.6, 7.1; ADR-0007, ADR-0008). The interface for the
 * edit dispatcher (T13) and the Gantt interactions (T16, T17).
 *
 * ## Contract
 *
 * - `planAction(action, ctx)` is pure. It reads the symbol index, the schedule the Gantt shows and
 *   its driving analysis, and returns one `EditIntent` (one undo step) with a toast label, or asks
 *   for the move preference, or says why the action is not possible here. It never applies
 *   anything, never schedules, and never reads the clock. A date it writes is a target taken
 *   from the engine's dates by whole working days (ADR-0007), never a computed schedule.
 * - `checkAction(action, ctx, ws)` (intents-check.ts) plans and then dry-runs the intent with
 *   `applyIntent` on `ws`, which must be the snapshot `ctx.index` was built from. It gives the
 *   edit, a no-op, or a refusal with its reason and one sentence from strings.ts. Refusals come
 *   from two places, and both are surfaced the same way: the Gantt's own (`NotPossibleReason`,
 *   decided here) and the edit API's (`RefusalReason`, decided by `applyIntent`, unchanged). T16
 *   uses it for the dry runs at drag start and on link-target change (7.3); T13 dispatches
 *   `planned.intent` itself, with its own stale re-plan and `shared-declaration` confirmation.
 * - Moves and resizes need a scheduled task: `ctx.result` with dates for it and `ctx.wt` from the
 *   same result's project. Without them they are `not-scheduled`. The other actions need only the
 *   index.
 * - The move kind (ADR-0008 #2): an ALAP task always writes `end`. An ASAP task uses the action's
 *   `kind`, else the preference; with neither it asks (`ask-move-preference`, with the kind to
 *   pre-select: `gap` when the task has a driving dependency written in its own text, else
 *   `start`). The preference `gap` on a task with no such driver writes `start` instead (as the
 *   spec's "default for tasks without a driving predecessor"); an explicit `kind: 'gap'` there is
 *   `no-driver`. `constraint: true` on the result means the edit adds a `start` or `end` the task
 *   did not have, so the UI can warn once (prefs.ts).
 * - Stable: T13 and T16 depend on these types. Add members; do not change existing ones.
 *
 * ## Mapping (7.1)
 *
 * | Action | Intent |
 * | --- | --- |
 * | resize (R1) | `setAttr` of the task's own sizing (`effort` scaled by the span and rounded to whole written units, "about"; `length` the working time to the end; `duration` the calendar time); a task with its own start and end, or an end and no size, `setAttr end`; no size and no end: `effort` when allocated, else `length` |
 * | size-step (R1 keys) | the own sizing value plus or minus whole written units (at least 1); otherwise as resize, with the end moved by whole working days |
 * | move (R2) | `setAttr start` (ASAP), `setAttr end` (ALAP), or `setDependsGap` on the driving dependency, `gaplength` old + days (a `gapduration`-only gap stays `gapduration`, by the calendar shift), 0 or less clears it |
 * | link (R3) | `addDepends(task = succ, target = pred)` |
 * | unlink (R4) | `removeDepends` of the first written site; an engine-only line is `engine-only` |
 * | reorder (R5) | `moveTask` (index as `moveTask` counts it: among the parent's other children) |
 * | assign, unassign (R6) | `addAllocation`, `removeAllocation` |
 * | replace-person (R7) | `replaceAllocation` |
 * | rename (R8) | `renameTask` |
 * | progress (R9) | `setAttr complete`, snapped to 5 % in 0..100; leaves only |
 * | add, delete | `addTask`, `deleteTask` |
 *
 * R10 (navigate) has no action: it never changes the text.
 *
 * Dates are written as a plain date (`2026-03-09`) when that means the same working time as the
 * target instant (a start at the day's first working minute, an end at its last), and with the
 * time otherwise, and always with the time for milestones and `duration` tasks, whose dates are
 * calendar times (schedule/date-text.ts writes them).
 */
import type { Minutes, ScheduleResult } from '../../engine/protocol';
import type { DrivingAnalysis } from '../schedule/critical';
import type { WorkingTime } from '../schedule/working-time';
import type { DependencySite, ResourceId, SourceRange, SymbolIndex, TaskId } from '../tjp/index';
import type { EditIntent, RefusalReason } from '../tjp/edit/types';
import type { ZoneOffsets } from '../tjp/values/civil';
import type { LinkState } from './model';

export type GanttActionType = GanttAction['type'];

/** How a move of an ASAP task changes the plan (ADR-0008 #2). */
export type MoveKind = 'start' | 'gap';

export interface MovePreference {
	readonly kind: MoveKind;
}

/** What `unlink` needs of a drawn line (a `GanttLink` fits; so does an inspector entry). */
export interface LinkRef {
	readonly pred: TaskId;
	readonly succ: TaskId;
	readonly state: LinkState;
	readonly sites: readonly DependencySite[];
}

export type GanttAction =
	/** R1: the bar's end dragged to `end` (snapped by the gesture's `DragSnapper`). */
	| { readonly type: 'resize'; readonly task: TaskId; readonly end: Minutes }
	/** R1 keys and steppers: the size by whole written units (or the end by working days). */
	| { readonly type: 'size-step'; readonly task: TaskId; readonly steps: number }
	/** R2: whole working days, either way. `kind` overrides the preference (inspector). */
	| {
			readonly type: 'move';
			readonly task: TaskId;
			readonly days: number;
			readonly kind?: MoveKind;
	  }
	| { readonly type: 'link'; readonly pred: TaskId; readonly succ: TaskId }
	| { readonly type: 'unlink'; readonly link: LinkRef }
	| {
			readonly type: 'reorder';
			readonly task: TaskId;
			readonly parent: TaskId | null;
			readonly index: number;
	  }
	| { readonly type: 'assign' | 'unassign'; readonly task: TaskId; readonly resource: ResourceId }
	| {
			readonly type: 'replace-person';
			readonly task: TaskId;
			readonly from: ResourceId;
			readonly to: ResourceId;
	  }
	| { readonly type: 'rename'; readonly task: TaskId; readonly name: string }
	| { readonly type: 'progress'; readonly task: TaskId; readonly percent: number }
	| {
			readonly type: 'add';
			readonly parent: TaskId | null;
			readonly index: number;
			readonly name: string;
	  }
	| { readonly type: 'delete'; readonly task: TaskId };

export interface ActionContext {
	/** Built from the snapshot the intent will apply to (T13: `runner.ensureIndex()`). */
	readonly index: SymbolIndex;
	/** The schedule the Gantt shows (`run.lastGood`); null before one. */
	readonly result: ScheduleResult | null;
	/** The driving analysis of that result (gantt/analysis.ts), or null while it is computed. */
	readonly analysis: DrivingAnalysis | null;
	/** `workingTimeOf(result.project, zones)`; null without a result. */
	readonly wt: WorkingTime | null;
	/** Zone data, for date text in a zone other than UTC. */
	readonly zones?: ZoneOffsets;
	/** The remembered move preference (prefs.ts); null until the user answers once. */
	readonly move: MovePreference | null;
}

/** For the toast and the undo entry ("Effort of Research: 3d to about 5d"). */
export interface ToastLabel {
	readonly text: string;
	/** The value is rounded (an effort scaled by a resize): shown as "about". */
	readonly approx: boolean;
}

/** Why the Gantt does not offer an action here, before the edit API is asked. */
export type NotPossibleReason =
	| 'milestone'
	| 'container'
	| 'text-only'
	| 'no-driver'
	/** A move of a task with its own `start` and `end`: one attribute cannot move it. */
	| 'start-and-end'
	/** An unlink of a line only the engine knows (a macro's): no text to remove. */
	| 'engine-only'
	/** A move or resize of a task without dates in the shown schedule. */
	| 'not-scheduled'
	/** No change: zero days, a size of zero, or a move past the driving limit. */
	| 'at-limit';

export type Planned =
	| {
			readonly status: 'intent';
			readonly intent: EditIntent;
			readonly label: ToastLabel;
			/** The edit adds a `start` or `end` the task did not have: warn once (ADR-0008 #2). */
			readonly constraint: boolean;
	  }
	| { readonly status: 'ask-move-preference'; readonly suggested: MoveKind }
	| {
			readonly status: 'not-possible';
			readonly reason: NotPossibleReason | Extract<RefusalReason, 'unknown-target'>;
			/** Where to show it in the text, when there is a place. */
			readonly at: readonly SourceRange[];
	  };

export { planAction, suggestedMoveKind, earliestStart, latestEnd } from './intents-plan';
export {
	checkAction,
	refusalMessage,
	type ActionOutcome,
	type ActionRefusal,
} from './intents-check';

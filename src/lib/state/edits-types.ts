// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The edit dispatcher's public types (edits.svelte.ts has the contract), apart from the class to
 * keep each file short.
 */
import type { Minutes, ScheduleResult } from '../../engine/protocol';
import type { ActionRefusal, GanttAction, MoveKind, ToastLabel } from '../gantt/intents';
import type { DrivingAnalysis } from '../schedule/critical';
import type { KeyTimers } from '../tjp/cm/android-key';
import type { EditIntent, NoopReason, SourceRange, TjpEdit } from '../tjp/edit/types';
import type { SymbolIndex, TaskId, TextOnlyReason } from '../tjp/index';
import type { ZoneOffsets } from '../tjp/values/civil';
import type { WorkspaceHistory } from '../workspace/history';
import type { WorkspacePath } from '../workspace/paths';
import type { ScheduleRunner } from '../workspace/run-types';
import type { Workspace, WorkspaceSnapshot } from '../workspace/workspace';
import type { Gesture } from './coalesce';
import type { Settlement } from './edits-settle';
import type { Outline } from './outline';
import type { PrefStorage } from './storage';

/** The dragged item's preview geometry, in minutes since the project start (from the gesture). */
export interface PendingMark {
	readonly task: TaskId;
	/** Null keeps the engine's date. */
	readonly start: Minutes | null;
	readonly end: Minutes | null;
	/** R9: the previewed percent complete. */
	readonly complete?: number;
}

/**
 * `preview` before the edit applies (coalescing, the Android gate), `pending` until the result
 * that includes it schedules, `not-scheduled` when that result does not (11.2: draw the bar at its
 * last good place with a "not scheduled" mark; the geometry no longer applies).
 */
export type PendingBarState = 'preview' | 'pending' | 'not-scheduled';

export interface PendingBar {
	readonly mark: PendingMark;
	readonly state: PendingBarState;
}

export interface PendingEdits {
	readonly byTask: ReadonlyMap<TaskId, PendingBar>;
	/** Old id to new id while a `moveTask` is pending (the selection follows it, 6.10). */
	readonly renames: ReadonlyMap<TaskId, TaskId>;
	/** Applied edits not yet settled. */
	readonly count: number;
}

/** What the Gantt draws: a result and its driving analysis, as one pair (`GanttAnalysis.shown`). */
export interface ActionSource {
	readonly result: ScheduleResult | null;
	readonly analysis: DrivingAnalysis | null;
}

export interface DispatchOptions {
	/** The toast's text and the undo entry's name. */
	readonly label: ToastLabel;
	/** Names a gesture: each call sends the cumulative total since it began (contract). */
	readonly coalesceKey?: string;
	/** Edit text read in several include visits (after the user confirmed `confirm-shared`). */
	readonly confirmShared?: boolean;
	/** The edit adds a `start` or `end` the task did not have (the one-time warning). */
	readonly constraint?: boolean;
	/** A drop: the preview mark is set now, and the edit is planned after the next frame (7.3). */
	readonly defer?: boolean;
	/**
	 * The index version the view read its targets in (ADR-0018). Default: the published
	 * `indexVersion` when `dispatch*` is called. A call made again after an answer passes the
	 * outcome's `basedOn`.
	 */
	readonly basedOn?: number;
}

export type ActionDispatchOptions = Pick<
	DispatchOptions,
	'coalesceKey' | 'confirmShared' | 'defer' | 'basedOn'
>;

/**
 * `unprepared`: the index could not be built (an error in the app, never the text's fault).
 * `planner`: a view planner (`dispatchPlan`) answered `not-possible` (ADR-0018); the outcome's
 * `message` is the planner's own sentence. A planner that throws is `unprepared`.
 */
export type DispatchRefusal = ActionRefusal | 'unprepared' | 'planner';

export type DispatchOutcome =
	| {
			readonly status: 'applied';
			readonly edit: TjpEdit;
			/** The history entry id (the edit's id). */
			readonly entry: string;
			/** The workspace version the edit produced. */
			readonly version: number;
			readonly toast: number;
			readonly settled: Promise<Settlement>;
	  }
	| {
			readonly status: 'refused';
			readonly reason: DispatchRefusal;
			readonly at: readonly SourceRange[];
			readonly message: string;
			readonly textOnly?: TextOnlyReason;
	  }
	| { readonly status: 'noop'; readonly reason: NoopReason; readonly message: string }
	/** Ask, then call again with `confirmShared: true` and this `basedOn` (ADR-0018). */
	| {
			readonly status: 'confirm-shared';
			readonly affects: readonly string[];
			readonly basedOn: number;
	  }
	/** Ask, then call again with this `basedOn` (ADR-0018). */
	| {
			readonly status: 'ask-move-preference';
			readonly suggested: MoveKind;
			readonly basedOn: number;
	  }
	| { readonly status: 'cancelled' };

/**
 * What a view planner reads (ADR-0018 decision 3): the text now and its index
 * (`index.version === snap.version`). The only state a planner gets.
 */
export interface PlanBase {
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
	/** The outline of `index`, built at most once per index. */
	outline(): Outline;
	/** `r`, read in version `basedOn`, in the text now; null when touched (ADR-0018 decision 2). */
	mapRange(r: SourceRange, basedOn: number): SourceRange | null;
	/** Whether `id` names the same declaration as in the call's `basedOn` (ADR-0018 decision 2). */
	isSame(kind: 'task' | 'resource', id: string): boolean;
}

/** A view planner's answer: an intent to check and apply, or why there is nothing to apply. */
export type ViewPlanned =
	| {
			readonly status: 'intent';
			readonly intent: EditIntent;
			readonly label: ToastLabel;
			readonly constraint?: boolean;
	  }
	| { readonly status: 'unchanged'; readonly message?: string }
	| {
			readonly status: 'not-possible';
			readonly message: string;
			readonly at: readonly SourceRange[];
	  };

/**
 * A relative command planned on the text now (`dispatchPlan`, ADR-0018 decision 3). Pure: reads
 * only `on` and the plain data it was made from. Called on every plan of the call.
 */
export type ViewPlanner = (on: PlanBase) => ViewPlanned;

export interface EditDispatcherDeps {
	readonly workspace: Workspace;
	readonly runner: Pick<ScheduleRunner, 'ensureIndex' | 'subscribe'>;
	/** `undo` here is the history's own, for replacing a gesture's edit (no note, no reveal). */
	readonly history: Pick<WorkspaceHistory, 'top' | 'redoTop' | 'subscribe' | 'undo'>;
	/** Undoes the top entry exactly as Mod-Z does (`HistoryControls.undo`). */
	readonly undo: () => unknown;
	/** True while the editor shows one of `paths` and CodeMirror holds an Android key. */
	readonly keyHeld?: (paths: readonly WorkspacePath[]) => boolean;
	/** Shows a range in the text (Text or Split; the phone's Text tab). */
	readonly reveal?: (r: SourceRange) => void;
	/** The move preference and the one-time warning (gantt/prefs.ts); null: none stored. */
	readonly storage?: PrefStorage | null;
	readonly zones?: ZoneOffsets;
	/** An edit deleted the plan's last task and its result is in (the empty state takes the focus). */
	readonly onEmptied?: () => void;
	/** Coalescing, the Android gate and toast timers; default the global timers. */
	readonly timers?: KeyTimers;
}

/** One call, as queued. */
export type Job = {
	readonly seq: number;
	/** `o.basedOn`, else the published `indexVersion` when the call was made (ADR-0018). */
	readonly basedOn: number;
	readonly preview: PendingMark | undefined;
	/** The coalesced gesture the call belongs to (coalesce.ts). */
	readonly gesture?: Gesture;
} & (
	| { readonly kind: 'intent'; readonly intent: EditIntent; readonly o: DispatchOptions }
	| {
			readonly kind: 'action';
			readonly action: GanttAction;
			readonly source: ActionSource;
			readonly o: ActionDispatchOptions;
	  }
);

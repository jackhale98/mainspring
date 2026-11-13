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
import type { TaskId, TextOnlyReason } from '../tjp/index';
import type { ZoneOffsets } from '../tjp/values/civil';
import type { WorkspaceHistory } from '../workspace/history';
import type { WorkspacePath } from '../workspace/paths';
import type { ScheduleRunner } from '../workspace/run-types';
import type { Workspace } from '../workspace/workspace';
import type { Settlement } from './edits-settle';
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
	/** Calls with the same key within `COALESCE_MS` keep only the newest (contract). */
	readonly coalesceKey?: string;
	/** Edit text read in several include visits (after the user confirmed `confirm-shared`). */
	readonly confirmShared?: boolean;
	/** The edit adds a `start` or `end` the task did not have (the one-time warning). */
	readonly constraint?: boolean;
}

export type ActionDispatchOptions = Pick<DispatchOptions, 'coalesceKey' | 'confirmShared'>;

/** `unprepared`: the index could not be built (an error in the app, never the text's fault). */
export type DispatchRefusal = ActionRefusal | 'unprepared';

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
	| { readonly status: 'confirm-shared'; readonly affects: readonly string[] }
	| { readonly status: 'ask-move-preference'; readonly suggested: MoveKind }
	| { readonly status: 'cancelled' };

export interface EditDispatcherDeps {
	readonly workspace: Workspace;
	readonly runner: Pick<ScheduleRunner, 'ensureIndex' | 'subscribe'>;
	readonly history: Pick<WorkspaceHistory, 'top' | 'redoTop' | 'subscribe'>;
	/** Undoes the top entry exactly as Mod-Z does (`HistoryControls.undo`). */
	readonly undo: () => unknown;
	/** True while the editor shows one of `paths` and CodeMirror holds an Android key. */
	readonly keyHeld?: (paths: readonly WorkspacePath[]) => boolean;
	/** Shows a range in the text (Text or Split; the phone's Text tab). */
	readonly reveal?: (r: SourceRange) => void;
	/** The move preference and the one-time warning (gantt/prefs.ts); null: none stored. */
	readonly storage?: PrefStorage | null;
	readonly zones?: ZoneOffsets;
	/** Coalescing, the Android gate and toast timers; default the global timers. */
	readonly timers?: KeyTimers;
}

/** One call, as queued. */
export type Job = { readonly seq: number; readonly preview: PendingMark | undefined } & (
	| { readonly kind: 'intent'; readonly intent: EditIntent; readonly o: DispatchOptions }
	| {
			readonly kind: 'action';
			readonly action: GanttAction;
			readonly source: ActionSource;
			readonly o: ActionDispatchOptions;
	  }
);

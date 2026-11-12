// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Types of the edit API (phase-1.md 6.5). Additions to the spec's interface, for T11 and Phase 2:
 *
 * - `LeaveRef` names a leave by its item range (`LeaveSite.items`), which the spec leaves open.
 * - RefusalReason gains `stale` (the index was not built from this snapshot) and
 *   `shared-declaration` (the target lies in a file TaskJuggler reads in several include visits,
 *   so one text change edits several engine ids; 15.8, 15.15). The refusal lists those ids in
 *   `affects`. `EditOptions.confirmShared` lets the intent through only when its handler declares
 *   the change the same in every visit (`IntentHandler.sameInEveryVisit`, apply.ts).
 * - A refusal may carry the blocking text-only reason (`textOnly`).
 * - `TjpEdit` is a `WorkspaceEdit`, so `Workspace.apply` takes it as it is.
 * - `EditOp`: one change an intent asks for, built by layout.ts and checked by apply.ts.
 */
import type { ChangeSet } from '@codemirror/state';
import type { WorkspaceEdit, WorkspaceSnapshot } from '../../workspace/workspace';
import type { WorkspacePath } from '../../workspace/paths';
import type { ResourceId, SourceRange, SymbolIndex, TaskId, TextOnlyReason } from '../index';
import type { Span } from '../text-only';
import type { Weekday } from '../values';

export type { ResourceId, SourceRange, Span, TaskId, Weekday, WorkspacePath };

export type TaskAttr =
	| 'effort'
	| 'duration'
	| 'length'
	| 'start'
	| 'end'
	| 'minstart'
	| 'maxend'
	| 'scheduling'
	| 'milestone'
	| 'priority'
	| 'note'
	| 'complete'
	| 'flags'
	| 'responsible';
export type ResourceAttr = 'efficiency' | 'rate' | 'email' | 'managers';
export type ProjectAttr =
	'timezone' | 'now' | 'timeformat' | 'currency' | 'dailyworkinghours' | 'weekstartsmonday';
/** Text as TaskJuggler writes it ('5d', '2026-03-02-09:00', 'alap'); booleans for flags; id lists. */
export type AttrValue = string | boolean | readonly string[];
export type Scope = { kind: 'project' } | { kind: 'resource'; resource: ResourceId };
export type LeaveType = 'holiday' | 'annual' | 'special' | 'sick' | 'unpaid' | 'unemployed';
export interface LeaveSpec {
	type: LeaveType;
	name?: string;
	/** A date. */
	start: string;
	/** A date, or a duration such as '+2d'. */
	end?: string;
}
/** A leave item, by its range as `LeaveSite.items` gives it. */
export interface LeaveRef {
	readonly item: SourceRange;
}

export type EditIntent =
	| { type: 'setAttr'; task: TaskId; attr: TaskAttr; value: AttrValue }
	| { type: 'removeAttr'; task: TaskId; attr: TaskAttr }
	| { type: 'renameTask'; task: TaskId; name: string }
	| {
			type: 'addTask';
			parent: TaskId | null;
			index: number;
			id?: string;
			name: string;
			attrs?: ReadonlyArray<readonly [TaskAttr, AttrValue]>;
	  }
	| { type: 'deleteTask'; task: TaskId }
	| { type: 'moveTask'; task: TaskId; parent: TaskId | null; index: number }
	/** `task` is the successor. */
	| { type: 'addDepends'; task: TaskId; target: TaskId }
	| { type: 'removeDepends'; task: TaskId; target: TaskId }
	| {
			type: 'setDependsGap';
			task: TaskId;
			target: TaskId;
			gap: { kind: 'gapduration' | 'gaplength'; value: string } | null;
	  }
	/** Replaces the task's own plain list. */
	| { type: 'allocate'; task: TaskId; resources: readonly ResourceId[] }
	| { type: 'addAllocation'; task: TaskId; resource: ResourceId }
	| { type: 'removeAllocation'; task: TaskId; resource: ResourceId }
	| { type: 'replaceAllocation'; task: TaskId; from: ResourceId; to: ResourceId }
	| {
			type: 'addResource';
			parent: ResourceId | null;
			index: number;
			id?: string;
			name: string;
			attrs?: ReadonlyArray<readonly [ResourceAttr, AttrValue]>;
	  }
	| { type: 'deleteResource'; resource: ResourceId }
	| { type: 'moveResource'; resource: ResourceId; parent: ResourceId | null; index: number }
	| { type: 'renameResource'; resource: ResourceId; name: string }
	| { type: 'setResourceAttr'; resource: ResourceId; attr: ResourceAttr; value: AttrValue }
	| { type: 'removeResourceAttr'; resource: ResourceId; attr: ResourceAttr }
	| { type: 'setProjectHeader'; name?: string; start?: string; end?: string }
	| { type: 'setProjectAttr'; attr: ProjectAttr; value: AttrValue }
	| { type: 'removeProjectAttr'; attr: ProjectAttr }
	| {
			type: 'setWorkingHours';
			scope: Scope;
			days: readonly Weekday[];
			hours: ReadonlyArray<readonly [string, string]> | 'off';
	  }
	| { type: 'addLeave'; scope: { kind: 'global' } | Scope; leave: LeaveSpec }
	| { type: 'updateLeave'; leave: LeaveRef; to: LeaveSpec }
	| { type: 'removeLeave'; leave: LeaveRef }
	| { type: 'declareFlag'; flag: string }
	/** Produced by formatFile only. */
	| { type: 'format'; file: WorkspacePath };

export type IntentType = EditIntent['type'];
export type IntentOf<K extends IntentType> = Extract<EditIntent, { type: K }>;

export type RefusalReason =
	| 'unknown-target'
	| 'text-only'
	| 'macro-in-body'
	| 'invalid-value'
	| 'conflicting-attribute'
	| 'inherited'
	| 'id-collision'
	| 'cycle'
	| 'unfixable-reference'
	| 'undeclared-flag'
	| 'unsafe-text'
	| 'needs-schedule'
	| 'syntax-error'
	| 'unsupported-form'
	| 'stale'
	| 'shared-declaration';
export type NoopReason = 'already-set' | 'already-linked' | 'not-present';

export interface TjpEdit extends WorkspaceEdit {
	/** One undo step in Phase 2; every transaction of the edit carries it as `tjpEditId`. */
	readonly id: string;
	readonly intent: EditIntent;
	/** TjpFile.version each change applies to (changed files only). */
	readonly base: Readonly<Record<WorkspacePath, number>>;
	/** Per changed file, from its base text. */
	readonly changes: Readonly<Record<WorkspacePath, ChangeSet>>;
	/** Per changed file, from its text after the edit back to the base text. */
	readonly inverse: Readonly<Record<WorkspacePath, ChangeSet>>;
	/** Declared target regions, in pre-edit coordinates; every change lies inside one. */
	readonly targets: Readonly<Record<WorkspacePath, readonly SourceRange[]>>;
	/** Post-edit, e.g. the new value. */
	readonly select: SourceRange | null;
}

export interface Refused {
	readonly status: 'refused';
	readonly reason: RefusalReason;
	readonly at: readonly SourceRange[];
	/** For `text-only` and `syntax-error` from a text-only range: the rule that blocked. */
	readonly textOnly?: TextOnlyReason;
	/** For `shared-declaration`: the task and resource ids the text change would edit. */
	readonly affects?: readonly string[];
}
export interface Noop {
	readonly status: 'noop';
	readonly reason: NoopReason;
}
export type EditResult = { readonly status: 'edit'; readonly edit: TjpEdit } | Noop | Refused;

/**
 * One change of an edit, in pre-edit coordinates of `file`: replace [from, to) with `insert`.
 * apply.ts checks `element` and the change range against the text-only ranges (both must be
 * safe, 15.10), refuses syntax errors in the statement around `element`, and declares the target
 * region `target` (default: the smallest span holding the element and the change).
 */
export interface EditOp {
	readonly file: WorkspacePath;
	readonly from: number;
	readonly to: number;
	readonly insert: string;
	/** The element the op edits: a value, statement, item or block; an insertion point. */
	readonly element: Span;
	readonly target?: Span;
	/** The part of `insert` (offsets into it) to select after the edit. */
	readonly select?: Span;
}

/** What an intent handler gives back: the ops of its edit, or a refusal, or a no-op. */
export type IntentPlan = readonly EditOp[] | Refused | Noop;

export interface EditOptions {
	/** Let an edit of text read in several include visits through (`shared-declaration`). */
	readonly confirmShared?: boolean;
	/** The edit id (default: a fresh one). */
	readonly id?: string;
}

/** What an intent handler gets: the snapshot, the index built from it, and the options. */
export interface EditContext {
	readonly ws: WorkspaceSnapshot;
	readonly index: SymbolIndex;
	readonly opts: EditOptions;
}

export function refused(
	reason: RefusalReason,
	at: readonly SourceRange[] = [],
	extra: { textOnly?: TextOnlyReason; affects?: readonly string[] } = {},
): Refused {
	return { status: 'refused', reason, at, ...extra };
}

export function noop(reason: NoopReason): Noop {
	return { status: 'noop', reason };
}

const statusOf = (x: unknown): unknown =>
	typeof x === 'object' && x !== null && 'status' in x ? x.status : undefined;

export function isRefused(x: unknown): x is Refused {
	return statusOf(x) === 'refused';
}

export function isNoop(x: unknown): x is Noop {
	return statusOf(x) === 'noop';
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Step 1 of the edit dispatcher (edits.svelte.ts): a fresh index, the plan (a Gantt action through
 * `planAction`, a view planner on the text now, or the intent as given), the checks of the targets
 * against the version they were read in (ADR-0018, edits-rebase.ts) and the edit API's dry run, all
 * on the current snapshot, or on a given one (a coalesced gesture's base, for a dry run only). Pure
 * apart from `ensureIndex`, which may derive the index now (it does not publish).
 *
 * The checks run on an intent or a Gantt action's plan, not on a planner's (it planned on the text
 * now), and only on a gesture's first call: its later calls plan on the gesture's base.
 *
 * `stale` (the index or the text moved under the plan) asks to plan again. Every other refusal,
 * `needs-schedule` included, is final: planning again at once would give the same answer.
 */
import type { ScheduleResult } from '../../engine/protocol';
import {
	checkAction,
	planAction,
	refusalMessage,
	type ActionContext,
	type ActionOutcome,
	type GanttAction,
	type ToastLabel,
} from '../gantt/intents';
import { readMovePreference } from '../gantt/prefs';
import { report } from '../report';
import { workingTimeOf, type WorkingTime } from '../schedule/working-time';
import { ganttActionStrings, toastStrings } from '../strings';
import { applyIntent } from '../tjp/edit/apply';
import type { EditIntent, EditOptions, SourceRange, TjpEdit } from '../tjp/edit/types';
import type { SymbolIndex, TaskId, TextOnlyReason } from '../tjp/index';
import type { HistoryIntent } from '../workspace/history-steps';
import type { ChangeOrigin, WorkspaceSnapshot } from '../workspace/workspace';
import { rebase, rebaser, type Kept } from './edits-rebase';
import type { Located } from './edits-settle';
import type {
	ActionSource,
	DispatchOutcome,
	DispatchRefusal,
	EditDispatcherDeps,
	Job,
	ViewPlanned,
} from './edits-types';

export type Prepared =
	| {
			readonly status: 'ready';
			readonly edit: TjpEdit;
			readonly label: ToastLabel;
			readonly constraint: boolean;
			/** The workspace version the edit was planned on. */
			readonly version: number;
			/** The snapshot and index it was planned on (a gesture's base). */
			readonly on: Base;
	  }
	/** `stale`: plan again on the newest snapshot and index; `outcome` is the refusal if not. */
	| { readonly status: 'replan'; readonly outcome: DispatchOutcome; readonly at?: Located }
	| { readonly status: 'done'; readonly outcome: DispatchOutcome; readonly at?: Located };

type Deps = Pick<EditDispatcherDeps, 'workspace' | 'runner' | 'storage' | 'zones'>;

/** A snapshot and the index built from it. */
export interface Base {
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
}

/** Working time per result, so a burst of actions on one result builds it once. */
const workingTimes = new WeakMap<ScheduleResult, WorkingTime | null>();

const unprepared = (e: unknown): Prepared => {
	report(e);
	return { status: 'done', outcome: refused('unprepared', [], toastStrings.unprepared) };
};

export function prepare(d: Deps, kept: Kept, job: Job, on?: Base): Prepared {
	let index: SymbolIndex;
	try {
		index = on?.index ?? d.runner.ensureIndex();
	} catch (e) {
		return unprepared(e);
	}
	const snap = on?.snap ?? d.workspace.snapshot();
	const at = (r: readonly SourceRange[]): { at?: Located } =>
		r[0] ? { at: { ...r[0], version: snap.version } } : {};
	// A gesture's later call and its dry run plan on the gesture's base: not checked (ADR-0018).
	const rb = rebaser(
		d.workspace,
		kept,
		snap,
		index,
		on || job.gesture?.base ? Infinity : job.basedOn,
	);
	let intent: EditIntent;
	let label: ToastLabel;
	let constraint: boolean;
	if (job.kind === 'plan') {
		let p: ViewPlanned;
		try {
			p = job.plan(rb);
		} catch (e) {
			return unprepared(e);
		}
		if (p.status === 'unchanged') {
			const message = p.message ?? ganttActionStrings.noop['already-set'];
			return { status: 'done', outcome: { status: 'noop', reason: 'already-set', message } };
		}
		if (p.status === 'not-possible') {
			return { status: 'done', outcome: refused('planner', p.at, p.message), ...at(p.at) };
		}
		({ intent, label } = p);
		constraint = p.constraint ?? false;
	} else if (job.kind === 'action') {
		// A gesture plans every call on the schedule its first call saw (coalesce.ts).
		const source = job.gesture?.source ?? job.source;
		const planned = planAction(job.action, contextOf(d, source, index));
		if (planned.status === 'ask-move-preference') {
			return { status: 'done', outcome: { ...planned, basedOn: job.basedOn } };
		}
		if (planned.status === 'not-possible') {
			const outcome = refused(planned.reason, planned.at, refusalMessage(planned.reason));
			return { status: 'done', outcome, ...at(planned.at) };
		}
		({ intent, label, constraint } = planned);
	} else {
		intent = job.intent;
		label = job.o.label;
		constraint = job.o.constraint ?? false;
	}
	if (job.kind !== 'plan') {
		const now = rebase(intent, rb);
		if (!now) {
			const ref =
				intent.type === 'updateLeave' || intent.type === 'removeLeave' ? intent.leave : null;
			const outcome = refused('target-changed', [], refusalMessage('target-changed'));
			// "Show in text" goes to where the old range is now.
			return { status: 'done', outcome, ...(ref && { at: { ...ref.item, version: ref.basedOn } }) };
		}
		intent = now;
	}
	const stale = refused('stale', [], refusalMessage('stale'));
	if (index.version !== snap.version) return { status: 'replan', outcome: stale };
	const confirmShared = job.o.confirmShared === true;
	const r = applyIntent(snap, index, intent, { confirmShared });
	if (r.status === 'edit') {
		const ready = { edit: r.edit, label, constraint, version: snap.version, on: { snap, index } };
		return { status: 'ready', ...ready };
	}
	if (r.status === 'noop') {
		const message = ganttActionStrings.noop[r.reason];
		return { status: 'done', outcome: { status: 'noop', reason: r.reason, message } };
	}
	const outcome = refused(r.reason, r.at, refusalMessage(r.reason), r.textOnly);
	if (r.reason === 'stale') return { status: 'replan', outcome, ...at(r.at) };
	if (r.reason === 'shared-declaration' && !confirmShared) {
		const affects = r.affects ?? [];
		return { status: 'done', outcome: { status: 'confirm-shared', affects, basedOn: job.basedOn } };
	}
	return { status: 'done', outcome, ...at(r.at) };
}

/**
 * A dry run of a Gantt action on the current text, applying nothing: what a drop would do, for
 * the gestures' checks at drag start and on a link target (phase-2.md 7.3). Null when there is no
 * answer to give (the index could not be built, or the text has moved past it: ask again).
 */
export function checkOn(
	d: Deps,
	action: GanttAction,
	source: ActionSource,
	opts: EditOptions = {},
): ActionOutcome | null {
	let index: SymbolIndex;
	try {
		index = d.runner.ensureIndex();
	} catch (e) {
		report(e);
		return null;
	}
	const snap = d.workspace.snapshot();
	if (index.version !== snap.version) return null;
	return checkAction(action, contextOf(d, source, index), snap, opts);
}

/** The `ActionContext` for a Gantt action on `index` (intents.ts). */
export function contextOf(d: Deps, source: ActionSource, index: SymbolIndex): ActionContext {
	const result = source.result;
	let wt: WorkingTime | null = null;
	if (result) {
		if (!workingTimes.has(result)) {
			workingTimes.set(result, result.project ? workingTimeOf(result.project, d.zones) : null);
		}
		wt = workingTimes.get(result) ?? null;
	}
	return {
		index,
		result,
		analysis: source.analysis,
		wt,
		...(d.zones ? { zones: d.zones } : {}),
		move: readMovePreference(d.storage ?? null),
	};
}

export function refused(
	reason: DispatchRefusal,
	at: readonly SourceRange[],
	message: string,
	textOnly?: TextOnlyReason,
): DispatchOutcome {
	return { status: 'refused', reason, at, message, ...(textOnly ? { textOnly } : {}) };
}

/** A task's id after `moveTask` puts it under `parent` (its local id stays). */
export function movedId(task: TaskId, parent: TaskId | null): TaskId {
	const local = task.slice(task.lastIndexOf('.') + 1);
	return parent === null ? local : `${parent}.${local}`;
}

/**
 * The task id an intent (or a history entry's intent) changes, old to new: a `moveTask` to another parent, or a `renameTask`
 * whose `id` sets a new local id (polish item 15). Null when no id changes.
 */
export function renamedBy(i: HistoryIntent): readonly [TaskId, TaskId] | null {
	if (i.type === 'moveTask') {
		const to = movedId(i.task, i.parent);
		return to === i.task ? null : [i.task, to];
	}
	if (i.type !== 'renameTask' || i.id === undefined) return null;
	const dot = i.task.lastIndexOf('.');
	const to = dot < 0 ? i.id : `${i.task.slice(0, dot)}.${i.id}`;
	return to === i.task ? null : [i.task, to];
}

/** Changes that can change ids (ADR-0018 decision 2), besides a `renamedBy` one. */
const ID_CHANGES = new Set([
	'text',
	'addTask',
	'deleteTask',
	'addResource',
	'deleteResource',
	'gapToTask',
]);

/**
 * Whether a workspace change can change ids: typing, a change of no known intent, and those intents.
 * An undo or redo is classified by its entry's intent (the history applies it as the change's edit).
 */
export const changesIds = (origin: ChangeOrigin, i?: { readonly type: string }): boolean =>
	origin !== 'format' && (!i || ID_CHANGES.has(i.type) || renamedBy(i as HistoryIntent) !== null);

/**
 * A gesture's total of zero (`size-step` by 0, `move` by 0 days): back to where the gesture began.
 * The Gantt would refuse it as `at-limit`; a gesture takes its edit out instead.
 */
export function isZeroTotal(job: Job): boolean {
	if (job.kind !== 'action') return false;
	const a = job.action;
	return (a.type === 'size-step' && a.steps === 0) || (a.type === 'move' && a.days === 0);
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Step 1 of the edit dispatcher (edits.svelte.ts): a fresh index, the plan (a Gantt action through
 * `planAction`, or the intent as given) and the edit API's dry run, all on the current snapshot.
 * Pure apart from `ensureIndex`, which may derive the index now (it does not publish).
 */
import type { ScheduleResult } from '../../engine/protocol';
import { planAction, refusalMessage, type ActionContext, type ToastLabel } from '../gantt/intents';
import { readMovePreference } from '../gantt/prefs';
import { report } from '../report';
import { workingTimeOf, type WorkingTime } from '../schedule/working-time';
import { ganttActionStrings, toastStrings } from '../strings';
import { applyIntent } from '../tjp/edit/apply';
import type { EditIntent, SourceRange, TjpEdit } from '../tjp/edit/types';
import type { SymbolIndex, TaskId, TextOnlyReason } from '../tjp/index';
import type { Located } from './edits-settle';
import type {
	ActionSource,
	DispatchOutcome,
	DispatchRefusal,
	EditDispatcherDeps,
	Job,
} from './edits-types';

export type Prepared =
	| {
			readonly status: 'ready';
			readonly edit: TjpEdit;
			readonly label: ToastLabel;
			readonly constraint: boolean;
			/** The workspace version the edit was planned on. */
			readonly version: number;
	  }
	/** `stale` or `needs-schedule`: plan again on the newest snapshot and index (once). */
	| { readonly status: 'replan' }
	| { readonly status: 'done'; readonly outcome: DispatchOutcome; readonly at?: Located };

type Deps = Pick<EditDispatcherDeps, 'workspace' | 'runner' | 'storage' | 'zones'>;

/** Working time per result, so a burst of actions on one result builds it once. */
const workingTimes = new WeakMap<ScheduleResult, WorkingTime | null>();

export function prepare(d: Deps, job: Job): Prepared {
	let index: SymbolIndex;
	try {
		index = d.runner.ensureIndex();
	} catch (e) {
		report(e);
		return { status: 'done', outcome: refused('unprepared', [], toastStrings.unprepared) };
	}
	const snap = d.workspace.snapshot();
	const at = (r: readonly SourceRange[]): { at?: Located } =>
		r[0] ? { at: { ...r[0], version: snap.version } } : {};
	let intent: EditIntent;
	let label: ToastLabel;
	let constraint: boolean;
	if (job.kind === 'action') {
		const planned = planAction(job.action, contextOf(d, job.source, index));
		if (planned.status === 'ask-move-preference') return { status: 'done', outcome: planned };
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
	if (index.version !== snap.version) return { status: 'replan' };
	const confirmShared = job.o.confirmShared === true;
	const r = applyIntent(snap, index, intent, { confirmShared });
	if (r.status === 'edit') {
		return { status: 'ready', edit: r.edit, label, constraint, version: snap.version };
	}
	if (r.status === 'noop') {
		const message = ganttActionStrings.noop[r.reason];
		return { status: 'done', outcome: { status: 'noop', reason: r.reason, message } };
	}
	if (r.reason === 'stale' || r.reason === 'needs-schedule') return { status: 'replan' };
	if (r.reason === 'shared-declaration' && !confirmShared) {
		return { status: 'done', outcome: { status: 'confirm-shared', affects: r.affects ?? [] } };
	}
	const outcome = refused(r.reason, r.at, refusalMessage(r.reason), r.textOnly);
	return { status: 'done', outcome, ...at(r.at) };
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

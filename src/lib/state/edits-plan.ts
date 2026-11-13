// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Step 1 of the edit dispatcher (edits.svelte.ts): a fresh index, the plan (a Gantt action through
 * `planAction`, or the intent as given) and the edit API's dry run, all on the current snapshot,
 * or on a given one (a coalesced gesture's base, for a dry run only). Pure apart from
 * `ensureIndex`, which may derive the index now (it does not publish).
 *
 * `stale` (the index or the text moved under the plan) asks to plan again. Every other refusal,
 * `needs-schedule` included, is final: planning again at once would give the same answer.
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
import type { WorkspaceSnapshot } from '../workspace/workspace';
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

export function prepare(d: Deps, job: Job, on?: Base): Prepared {
	let index: SymbolIndex;
	try {
		index = on?.index ?? d.runner.ensureIndex();
	} catch (e) {
		report(e);
		return { status: 'done', outcome: refused('unprepared', [], toastStrings.unprepared) };
	}
	const snap = on?.snap ?? d.workspace.snapshot();
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
		return { status: 'done', outcome: { status: 'confirm-shared', affects: r.affects ?? [] } };
	}
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

/**
 * A gesture's total of zero (`size-step` by 0, `move` by 0 days): back to where the gesture began.
 * The Gantt would refuse it as `at-limit`; a gesture takes its edit out instead.
 */
export function isZeroTotal(job: Job): boolean {
	if (job.kind !== 'action') return false;
	const a = job.action;
	return (a.type === 'size-step' && a.steps === 0) || (a.type === 'move' && a.days === 0);
}

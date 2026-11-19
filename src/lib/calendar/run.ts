// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Calendar's way into the edit dispatcher (phase-3.md 6.6, 7.1 W3 to W5): a painted or erased
 * stroke goes through T12's planner, a changed or removed leave through leave-edit.ts, and what
 * comes out is one intent for the dispatcher, which makes it one undo step with a toast (desktop)
 * or the quiet strip (phone), the pending mark, and the confirmation for a shared `.tji`.
 * Views never change the plan: this plans and sends, and says why when it does not.
 *
 * - **A refusal of the planner** (`not-possible`) is shown as a toast with "Show in text" where it
 *   has a place (`edits.refuse`): its sentence is the planner's (`leavePaintMessage`), except for a
 *   text-only leave, which says what the day is ("From a shift or macro. Edit as text.").
 * - **A refusal of the edit API** (inherited, a vacation split, text-only, shared) comes back as the
 *   dispatcher's own outcome, already shown.
 * - **A shared declaration** (`confirm-shared`) asks once through `confirm`, then sends again with
 *   `confirmShared`: a leave of a resource in a `.tji` several files read changes all of them.
 * - **`paintPlan`** (ADR-0018 decision 3) is a stroke as a view planner for `dispatchPlan`: the
 *   dispatcher runs `planLeavePaint` on the text now, so a stroke never merges into an item read
 *   from an index that lags the text. Its refusals keep the sentences above; a person whose id now
 *   names another declaration is refused with the edit API's `target-changed` sentence.
 */
import {
	fieldError,
	leaveEditPlan,
	leaveRemovePlan,
	type CommitResult,
	type EditContext,
	type LeaveFields,
} from './leave-edit';
import { leavePaintMessage, planLeavePaint, type LeavePaint } from './paint';
import type { ScheduleResult } from '../../engine/protocol';
import type { ToastLabel } from '../gantt/intents';
import type { DispatchOptions, DispatchOutcome, ViewPlanner } from '../state/edits.svelte';
import { inspectorStrings, refusalStrings } from '../strings';
import { calendarStrings as C } from '../strings-calendar';
import type { EditIntent, LeaveRef } from '../tjp/edit/types';
import type { ZoneOffsets } from '../tjp/values/civil';

/** The part of the dispatcher the Calendar uses. */
export interface LeaveEdits {
	dispatch(intent: EditIntent, o: DispatchOptions): Promise<DispatchOutcome>;
	dispatchPlan(plan: ViewPlanner, o?: Omit<DispatchOptions, 'label'>): Promise<DispatchOutcome>;
}

export type RunResult =
	/** Nothing was sent: no dispatcher, or the planner said not possible (`message` is shown). */
	| { readonly status: 'refused' | 'unavailable'; readonly message: string }
	/** The dispatcher has it; its outcome says what became of it. */
	| { readonly status: 'sent'; readonly outcome: DispatchOutcome };

type Sent = { confirmShared: boolean; basedOn?: number };

/**
 * Sends a call, asking once when the edit would apply in several places. The call made again
 * after the answer passes the first outcome's `basedOn`, so both read the same text (ADR-0018).
 */
async function asking(
	send: (o: Sent) => Promise<DispatchOutcome>,
	confirm: (message: string) => boolean,
	basedOn?: number,
): Promise<DispatchOutcome> {
	let o: Sent = { confirmShared: false, ...(basedOn === undefined ? {} : { basedOn }) };
	for (let i = 0; i < 2; i++) {
		const outcome = await send(o);
		if (outcome.status !== 'confirm-shared') return outcome;
		if (!confirm(inspectorStrings.confirmShared(outcome.affects.join(', ')))) {
			return { status: 'cancelled' };
		}
		o = { confirmShared: true, basedOn: outcome.basedOn };
	}
	return { status: 'cancelled' };
}

/**
 * Sends an intent. `basedOn` is the index version the view read its targets in (default: the
 * dispatcher's stamp).
 */
export function runIntent(
	edits: LeaveEdits,
	intent: EditIntent,
	label: ToastLabel,
	confirm: (message: string) => boolean,
	basedOn?: number,
): Promise<DispatchOutcome> {
	return asking((o) => edits.dispatch(intent, { label, ...o }), confirm, basedOn);
}

/** Sends a view planner's command, planned by the dispatcher on the text now. */
export function runPlan(
	edits: LeaveEdits,
	plan: ViewPlanner,
	confirm: (message: string) => boolean,
): Promise<DispatchOutcome> {
	return asking((o) => edits.dispatchPlan(plan, o), confirm);
}

/**
 * A leave card's commit (ADR-0018 decision 5), sent at once and planned by the dispatcher on the
 * text now: `ref` is mapped there, so the item is the one the card shows even while the index lags.
 * Fields that cannot be written are answered here, before anything is sent (the card says why under
 * them); the edit API's refusals have their toast already. An applied edit answers with the item as
 * it wrote it.
 */
export async function runLeaveEdit(
	edits: LeaveEdits | null,
	ref: LeaveRef,
	f: LeaveFields,
	ctx: Omit<EditContext, 'index'> | null,
	confirm: (message: string) => boolean,
): Promise<CommitResult> {
	const error = fieldError(f);
	if (error) return { error };
	if (!edits || !ctx) return {};
	const o = await runPlan(edits, leaveEditPlan(ref, f, ctx), confirm);
	if (o.status !== 'applied') return {};
	return {
		applied: true,
		...(o.edit.select ? { ref: { item: o.edit.select, basedOn: o.version } } : {}),
	};
}

/** A leave card's Remove, planned by the dispatcher on the text now. */
export async function runLeaveRemove(
	edits: LeaveEdits | null,
	ref: LeaveRef,
	ctx: Pick<EditContext, 'project'> | null,
	confirm: (message: string) => boolean,
): Promise<void> {
	if (edits && ctx) await runPlan(edits, leaveRemovePlan(ref, ctx), confirm);
}

/**
 * Sends a paint or erase stroke, planned by the dispatcher on the text now. A refusal of the
 * planner (`not-possible`) has its toast already, with "Show in text" where it has a place; its
 * sentence is also returned, for the view's note.
 */
export async function runStroke(
	edits: LeaveEdits | null,
	stroke: LeavePaint,
	result: ScheduleResult | null,
	zones: ZoneOffsets,
	confirm: (message: string) => boolean,
): Promise<RunResult> {
	if (!edits || !result) return { status: 'unavailable', message: '' };
	const outcome = await runPlan(edits, paintPlan(stroke, result, zones), confirm);
	return outcome.status === 'refused' && outcome.reason === 'planner'
		? { status: 'refused', message: outcome.message }
		: { status: 'sent', outcome };
}

/** A paint or erase stroke, planned by the dispatcher on the text now (module comment). */
export function paintPlan(
	stroke: LeavePaint,
	result: ScheduleResult,
	zones: ZoneOffsets,
): ViewPlanner {
	return (on) => {
		const s = stroke.scope;
		if (s.kind === 'resource' && on.index.resources.has(s.resource)) {
			if (!on.isSame('resource', s.resource)) {
				return { status: 'not-possible', message: refusalStrings['target-changed'], at: [] };
			}
		}
		const p = planLeavePaint(stroke, { index: on.index, result, zones });
		if (p.status === 'intent') return { status: 'intent', intent: p.intent, label: p.label };
		if (p.status === 'not-possible') {
			const message = p.reason === 'text-only' ? C.textOnly : leavePaintMessage(p);
			return { status: 'not-possible', message, at: p.at };
		}
		// `ask-move-preference` is the Gantt's and never comes from a leave stroke.
		return { status: 'unchanged' };
	};
}

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
import type { PaintPlanned } from './paint';
import {
	leavePaintMessage,
	planLeavePaint,
	type LeavePaint,
	type LeavePaintContext,
} from './paint';
import type { ScheduleResult } from '../../engine/protocol';
import type { ToastLabel } from '../gantt/intents';
import type { DispatchOptions, DispatchOutcome, ViewPlanner } from '../state/edits.svelte';
import { inspectorStrings, refusalStrings } from '../strings';
import { calendarStrings as C } from '../strings-calendar';
import type { EditIntent } from '../tjp/edit/types';
import type { SourceRange } from '../tjp/index';
import type { ZoneOffsets } from '../tjp/values/civil';

/** The part of the dispatcher the Calendar uses. */
export interface LeaveEdits {
	dispatch(intent: EditIntent, o: DispatchOptions): Promise<DispatchOutcome>;
	/** A refusal of the view's own: a toast that stays, with "Show in text" when it has a place. */
	refuse(message: string, at: readonly SourceRange[], version: number): void;
}

export type RunResult =
	/** Nothing was sent: no dispatcher, or the planner said not possible (`message` is shown). */
	| { readonly status: 'refused' | 'unavailable'; readonly message: string }
	/** The dispatcher has it; its outcome says what became of it. */
	| { readonly status: 'sent'; readonly outcome: DispatchOutcome };

/** Sends an intent, asking once when the edit would apply in several places. */
export async function runIntent(
	edits: LeaveEdits,
	intent: EditIntent,
	label: ToastLabel,
	confirm: (message: string) => boolean,
): Promise<DispatchOutcome> {
	let confirmShared = false;
	for (let i = 0; i < 2; i++) {
		const outcome = await edits.dispatch(intent, { label, confirmShared });
		if (outcome.status !== 'confirm-shared') return outcome;
		if (!confirm(inspectorStrings.confirmShared(outcome.affects.join(', ')))) {
			return { status: 'cancelled' };
		}
		confirmShared = true;
	}
	return { status: 'cancelled' };
}

/** Plans a paint or erase stroke and sends it. */
export async function runStroke(
	edits: LeaveEdits | null,
	stroke: LeavePaint,
	ctx: LeavePaintContext | null,
	confirm: (message: string) => boolean,
): Promise<RunResult> {
	if (!edits || !ctx) return { status: 'unavailable', message: '' };
	const plan: PaintPlanned = planLeavePaint(stroke, ctx);
	if (plan.status === 'intent') {
		return { status: 'sent', outcome: await runIntent(edits, plan.intent, plan.label, confirm) };
	}
	if (plan.status === 'not-possible') {
		const message = plan.reason === 'text-only' ? C.textOnly : leavePaintMessage(plan);
		edits.refuse(message, plan.at, ctx.index.version);
		return { status: 'refused', message };
	}
	// `ask-move-preference` is the Gantt's and never comes from a leave stroke.
	return { status: 'unavailable', message: '' };
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

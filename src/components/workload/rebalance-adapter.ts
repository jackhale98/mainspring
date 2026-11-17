// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's way into the edit dispatcher for W1 and W2 (phase-3.md 6.6, 7.1, 18.9): one small
 * adapter between the drops, the cell details' menus and the Alt+arrow keys on one side and T12's
 * planner on the other. Views never change the plan: this plans a `RebalanceAction` with the
 * planner and sends what comes back (an edit intent, or a Gantt `move` action) to the dispatcher,
 * which makes it one undo step with a toast, a pending mark and the shared-text confirmation.
 *
 * - **The planner** is T12's `planRebalance` (src/lib/workload/rebalance.ts), `PLANNER`.
 * - **Refusals** (`not-possible`) say their sentence (`rebalanceMessage`) in a toast with "Show in
 *   text" where the refusal has a place in the text (`edits.refuse`: review finding 5, left to the
 *   views); the dispatcher's own refusals (`inherited`, alternatives, `text-only`) are already
 *   shown by the dispatcher, with their "Show in text".
 * - **Keys** (`Nudges`): Alt+Up and Alt+Down move a task one person per press, Alt+Left and
 *   Alt+Right one bucket per press. Each press sends the cumulative offset of a gesture named by a
 *   coalesce key, `rebalance:<task>:<from>` and `shift:<task>` (7.1), so a run of presses is one
 *   undo step; `flush` (blur, Enter) ends the gesture and the offset starts again from zero.
 */
import type { ActionContext, GanttAction, MoveKind } from '../../lib/gantt/intents';
import type {
	ActionDispatchOptions,
	ActionSource,
	DispatchOptions,
	DispatchOutcome,
} from '../../lib/state/edits.svelte';
import { inspectorStrings } from '../../lib/strings';
import type { EditIntent } from '../../lib/tjp/edit/types';
import {
	planRebalance,
	type PlanRebalanceFn,
	type RebalanceAction,
} from '../../lib/workload/rebalance';
import { rebalanceMessage } from '../../lib/workload/rebalance-check';
import type { ResourceId, SourceRange, TaskId } from '../../lib/tjp/index';
import type { Cell } from '../../lib/workload/heat-layout';
import { personAt, shiftOf } from '../../lib/workload/heat-drag';
import type { LoadModel } from '../../lib/workload/types';

/** T12's planner. */
export const PLANNER: PlanRebalanceFn = planRebalance;

/** The part of the dispatcher the adapter uses. */
export interface RebalanceEdits {
	dispatch(intent: EditIntent, o: DispatchOptions): Promise<DispatchOutcome>;
	dispatchAction(
		action: GanttAction,
		source: ActionSource,
		o?: ActionDispatchOptions,
	): Promise<DispatchOutcome>;
	setMovePreference(kind: MoveKind | null): void;
	flush(key?: string): void;
	/** A refusal of the view's own: a toast that stays, with "Show in text" when it has a place. */
	refuse(message: string, at: readonly SourceRange[], version: number): void;
}

export interface RebalanceEnv {
	readonly planner: PlanRebalanceFn;
	edits(): RebalanceEdits | null;
	/** The planner's context: the index, the shown result and what the Gantt's planner needs. */
	context(): ActionContext | null;
	source(): ActionSource;
	/** The move question (ADR-0008 #2), answered by a dialog; null cancels. */
	askMove(suggested: MoveKind): Promise<MoveKind | null>;
	confirm(message: string): boolean;
}

export type RebalanceResult =
	/** Nothing was sent: no dispatcher or context, or the planner said not possible. */
	| { readonly status: 'unavailable' | 'refused'; readonly message: string }
	/** The dispatcher has it; its outcome says what became of it. */
	| { readonly status: 'sent'; readonly outcome: DispatchOutcome };

export interface RunOptions {
	readonly coalesceKey?: string;
}

export class Rebalancer {
	readonly #env: RebalanceEnv;

	constructor(env: RebalanceEnv) {
		this.#env = env;
	}

	async run(action: RebalanceAction, o: RunOptions = {}): Promise<RebalanceResult> {
		const env = this.#env;
		const edits = env.edits();
		if (!edits) return { status: 'unavailable', message: '' };
		const ctx = env.context();
		if (!ctx) return { status: 'unavailable', message: '' };
		const plan = env.planner(action, ctx);
		if (plan.status === 'not-possible') {
			const message = rebalanceMessage(plan, ctx, action);
			edits.refuse(message, plan.at, ctx.index.version);
			return { status: 'refused', message };
		}
		const coalesce = o.coalesceKey === undefined ? {} : { coalesceKey: o.coalesceKey };
		let confirmShared = false;
		for (let i = 0; i < 3; i++) {
			const outcome =
				plan.status === 'intent'
					? await edits.dispatch(plan.intent, { label: plan.label, confirmShared, ...coalesce })
					: await edits.dispatchAction(plan.action, env.source(), { confirmShared, ...coalesce });
			if (outcome.status === 'ask-move-preference') {
				const kind = await env.askMove(outcome.suggested);
				if (kind === null) return { status: 'sent', outcome: { status: 'cancelled' } };
				edits.setMovePreference(kind);
			} else if (outcome.status === 'confirm-shared') {
				if (!env.confirm(inspectorStrings.confirmShared(outcome.affects.join(', ')))) {
					return { status: 'sent', outcome: { status: 'cancelled' } };
				}
				confirmShared = true;
			} else return { status: 'sent', outcome };
		}
		return { status: 'sent', outcome: { status: 'cancelled' } };
	}

	/** Ends a keyboard gesture (blur, Enter): its held edit is dispatched now. */
	flush(key?: string): void {
		this.#env.edits()?.flush(key);
	}
}

/** The cumulative offsets of the Alt+arrow presses, one gesture per task (and person). */
export class Nudges {
	readonly #by = new Map<string, number>();
	readonly #rebalancer: Rebalancer;

	constructor(rebalancer: Rebalancer) {
		this.#rebalancer = rebalancer;
	}

	/** Alt+Up (-1) or Alt+Down (+1): the task to another person. Null when nothing could move. */
	async person(
		model: LoadModel,
		task: TaskId,
		cell: Cell,
		step: -1 | 1,
	): Promise<RebalanceResult | null> {
		const from = model.rows[cell.row]?.id as ResourceId | undefined;
		if (from === undefined) return null;
		const key = `rebalance:${task}:${from}`;
		const offset = (this.#by.get(key) ?? 0) + step;
		const to = personAt(model, cell.row, offset);
		const target = to === null ? undefined : model.rows[to];
		// At the end of the list (or on the origin) a press changes nothing: send nothing.
		if (!target || to === cell.row || to === personAt(model, cell.row, offset - step)) return null;
		return this.#send(key, offset, step, { type: 'reassign', task, from, to: target.id });
	}

	/** Alt+Left (-1) or Alt+Right (+1): the task one bucket earlier or later. */
	async period(
		model: LoadModel,
		task: TaskId,
		cell: Cell,
		step: -1 | 1,
	): Promise<RebalanceResult | null> {
		const key = `shift:${task}`;
		const offset = (this.#by.get(key) ?? 0) + step;
		const clamp = (o: number): number => Math.max(0, Math.min(model.axis.count - 1, cell.col + o));
		const col = clamp(offset);
		if (col === cell.col || col === clamp(offset - step)) return null;
		const action = shiftOf(model, task, cell.col, col);
		if (!action) return null;
		return this.#send(key, offset, step, action);
	}

	/**
	 * Sends the cumulative ask. The offset counts at once (a second press must not wait for the first
	 * to be dispatched, which the coalescing holds back), and goes back a step when the ask was
	 * refused: a refused press is not a press, so the next one asks for the same place again.
	 */
	async #send(
		key: string,
		offset: number,
		step: number,
		action: RebalanceAction,
	): Promise<RebalanceResult> {
		this.#by.set(key, offset);
		const r = await this.#rebalancer.run(action, { coalesceKey: key });
		const refused =
			r.status !== 'sent' || r.outcome.status === 'refused' || r.outcome.status === 'noop';
		if (refused && this.#by.get(key) === offset) this.#by.set(key, offset - step);
		return r;
	}

	/** Blur or Enter: dispatches what is held and starts every offset again from zero. */
	end(): void {
		this.#by.clear();
		this.#rebalancer.flush();
	}
}

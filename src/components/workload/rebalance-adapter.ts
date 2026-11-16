// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's way into the edit dispatcher for W1 and W2 (phase-3.md 6.6, 7.1, 18.9): one small
 * adapter between the drops, the cell details' menus and the Alt+arrow keys on one side and T12's
 * planner on the other. Views never change the plan: this plans a `RebalanceAction` with the
 * planner and sends what comes back (an edit intent, or a Gantt `move` action) to the dispatcher,
 * which makes it one undo step with a toast, a pending mark and the shared-text confirmation.
 *
 * - **No planner yet.** `PLANNER` is null until T12 (`planRebalance` in
 *   src/lib/workload/rebalance.ts) merges; then every move says "coming" and nothing is sent. The
 *   switch is that one constant.
 * - **Refusals** (`not-possible`) say their sentence in the app's message strip or toast
 *   (`edits.say`); the dispatcher's own refusals are already shown by the dispatcher.
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
import { inspectorStrings, workloadStrings as W } from '../../lib/strings';
import type { EditIntent } from '../../lib/tjp/edit/types';
import type { PlanRebalanceFn, RebalanceAction } from '../../lib/workload/rebalance';
import type { ResourceId, TaskId } from '../../lib/tjp/index';
import type { Cell } from '../../lib/workload/heat-layout';
import { personAt } from '../../lib/workload/heat-drag';
import type { LoadModel } from '../../lib/workload/types';

/** T12's `planRebalance`, once it merges: `import { planRebalance } from '...rebalance'`. */
export const PLANNER: PlanRebalanceFn | null = null;

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
	say(message: string, sticky?: boolean): void;
}

export interface RebalanceEnv {
	/** Null until T12 merges (`PLANNER`). */
	readonly planner: PlanRebalanceFn | null;
	edits(): RebalanceEdits | null;
	/** The planner's context: the index, the shown result and what the Gantt's planner needs. */
	context(): ActionContext | null;
	source(): ActionSource;
	/** The move question (ADR-0008 #2), answered by a dialog; null cancels. */
	askMove(suggested: MoveKind): Promise<MoveKind | null>;
	confirm(message: string): boolean;
}

export type RebalanceResult =
	/** Nothing was sent: no planner yet, no dispatcher, or the planner said not possible. */
	| { readonly status: 'coming' | 'unavailable' | 'refused'; readonly message: string }
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

	/** Whether moves can be planned at all (false until T12 merges). */
	get ready(): boolean {
		return this.#env.planner !== null;
	}

	async run(action: RebalanceAction, o: RunOptions = {}): Promise<RebalanceResult> {
		const env = this.#env;
		const edits = env.edits();
		if (!edits) return { status: 'unavailable', message: '' };
		const say = (message: string): RebalanceResult => {
			edits.say(message);
			return { status: 'coming', message };
		};
		const planner = env.planner;
		if (planner === null) return say(W.rebalance.coming);
		const ctx = env.context();
		if (!ctx) return { status: 'unavailable', message: '' };
		const plan = planner(action, ctx);
		if (plan.status === 'not-possible') {
			const message = W.rebalance.refusal[plan.reason];
			edits.say(message);
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
		this.#by.set(key, offset);
		return this.#rebalancer.run(
			{ type: 'reassign', task, from, to: target.id },
			{ coalesceKey: key },
		);
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
		this.#by.set(key, offset);
		return this.#rebalancer.run(
			{
				type: 'shift',
				task,
				fromBucket: model.axis.bounds[cell.col] as number,
				toBucket: model.axis.bounds[col] as number,
			},
			{ coalesceKey: key },
		);
	}

	/** Blur or Enter: dispatches what is held and starts every offset again from zero. */
	end(): void {
		this.#by.clear();
		this.#rebalancer.flush();
	}
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the heatmap and the lanes share of rebalancing (phase-3.md 6.6, 7.1 W1 and W2, 18.9): the
 * planner's context from the newest good result, the dry run of a drop, the drop itself (with
 * "Move which task?" when a cell holds several), the details' menus and the Alt+arrow keys, and the
 * move question (ADR-0008 #2) and the refusal note that go with them. Both views own one; the
 * views draw and the gestures aim, and everything that changes the plan goes through
 * `Rebalancer` (rebalance-adapter.ts) to the dispatcher as one undo step. Nothing here edits the
 * plan itself.
 */
import { analysisOf } from '../../lib/gantt/analysis';
import type { ActionContext, MoveKind } from '../../lib/gantt/intents';
import { readMovePreference } from '../../lib/gantt/prefs';
import { workingTimeOf } from '../../lib/schedule/working-time';
import type { AppState } from '../../lib/state/app.svelte';
import { browserStorage } from '../../lib/state/storage';
import { workloadStrings as W } from '../../lib/strings-workload';
import type { DetailTask } from '../../lib/workload/heat-cell';
import { shiftOf } from '../../lib/workload/heat-drag';
import type { Cell } from '../../lib/workload/heat-layout';
import type { RebalanceAction } from '../../lib/workload/rebalance';
import { checkRebalance } from '../../lib/workload/rebalance-check';
import { dropTask } from '../../lib/workload/rebalance-drop';
import type { LoadModel } from '../../lib/workload/types';
import type { HeatHost } from './heat-gestures.svelte';
import type { HeatState } from './heat-state.svelte';
import { Nudges, PLANNER, Rebalancer } from './rebalance-adapter';

/** "Move which task?": what the drop asks for, the tasks to choose from, and what each would do. */
export interface WhichAsk {
	readonly label: string;
	readonly tasks: ReadonlyArray<{ task: string; name: string; minutes: number }>;
	readonly plan: (t: { task: string } | null) => { action: RebalanceAction | null };
}

export interface RebalanceHostDeps {
	readonly app: AppState;
	/** The view's load state: the result the picture shows, and the zones its axis was made with. */
	readonly loads: HeatState;
	readonly taskNames: () => ReadonlyMap<string, string>;
	/** Says something to a screen reader (the view's polite live region). */
	readonly announce: (text: string) => void;
}

export class RebalanceHost {
	/** The last refusal's sentence, for the details' note: said once. */
	note = $state('');
	moveAsk = $state.raw<{ suggested: MoveKind } | null>(null);
	which = $state.raw<WhichAsk | null>(null);
	readonly nudges: Nudges;
	readonly #d: RebalanceHostDeps;
	readonly #rebalancer: Rebalancer;
	#answer: ((k: MoveKind | null) => void) | null = null;

	constructor(deps: RebalanceHostDeps) {
		this.#d = deps;
		this.#rebalancer = new Rebalancer({
			planner: PLANNER,
			edits: () => deps.app.edits,
			context: () => this.context(),
			source: () => {
				const r = deps.loads.built?.result ?? null;
				return { result: r, analysis: r ? analysisOf(r) : null };
			},
			askMove: (suggested) =>
				new Promise((resolve) => {
					this.#answer = resolve;
					this.moveAsk = { suggested };
				}),
			confirm: (m) => globalThis.confirm(m),
		});
		this.nudges = new Nudges(this.#rebalancer);
	}

	/** The planner's context: the index, the shown result and what the Gantt's planner needs. */
	context(): ActionContext | null {
		const { app, loads } = this.#d;
		const built = loads.built;
		const index = app.index;
		if (!built?.result.project || !index) return null;
		return {
			index,
			result: built.result,
			analysis: analysisOf(built.result),
			wt: workingTimeOf(built.result.project, loads.zones),
			zones: loads.zones,
			move: readMovePreference(browserStorage()),
		};
	}

	/** The dry run of a drop (7.2): planned and checked on the snapshot the index was built from. */
	check: HeatHost['check'] = (action) => {
		const snap = this.#d.app.workspace?.snapshot();
		const ctx = this.context();
		if (!snap || !ctx || ctx.index.version !== snap.version) return null;
		const o = checkRebalance(action, ctx, snap);
		return o.status === 'refused' ? { ok: false, message: o.message } : { ok: true, message: null };
	};

	async perform(action: RebalanceAction | null): Promise<void> {
		if (!action) return;
		const r = await this.#rebalancer.run(action);
		// A refusal is a toast (with Show in text where it has a place) and the details' note: said once.
		this.note = r.status === 'refused' ? r.message : '';
	}

	/** A drop: one task goes at once, several ask which first. */
	drop: HeatHost['drop'] = (d) => {
		const pick = dropTask(d.tasks);
		if (pick.kind === 'none') return;
		if (pick.kind === 'one') {
			void this.perform(d.plan(d.tasks.find((t) => t.task === pick.task) ?? null).action);
			return;
		}
		const names = this.#d.taskNames();
		this.which = {
			label: d.plan(null).label,
			tasks: d.tasks.map((t) => ({
				task: t.task,
				name: names.get(t.task) ?? t.task,
				minutes: t.minutes,
			})),
			plan: (t) => d.plan(d.tasks.find((x) => x.task === t?.task) ?? null),
		};
	};

	/** The details' menus: a task to a person's row or to a column. */
	moveTask(
		model: LoadModel,
		selected: Cell | null,
		t: DetailTask,
		to: { row: number } | { col: number },
	): void {
		if (!selected) return;
		const from = model.rows[selected.row];
		if ('row' in to) {
			const target = model.rows[to.row];
			if (from && target) {
				void this.perform({ type: 'reassign', task: t.task, from: from.id, to: target.id });
			}
			return;
		}
		void this.perform(shiftOf(model, t.task, selected.col, to.col));
	}

	/** Alt+arrows in the details: one person or one period per press, cumulative. */
	async nudge(
		model: LoadModel,
		selected: Cell | null,
		t: DetailTask,
		axis: 'person' | 'period',
		step: -1 | 1,
	): Promise<void> {
		if (!selected) return;
		const r =
			axis === 'person'
				? await this.nudges.person(model, t.task, selected, step)
				: await this.nudges.period(model, t.task, selected, step);
		if (r && r.status === 'refused') this.note = r.message;
	}

	/** The move question's answer (null cancels). */
	answerMove(kind: MoveKind | null): void {
		this.moveAsk = null;
		this.#answer?.(kind);
		this.#answer = null;
	}

	/** "Move which task?": the task chosen. */
	choose(task: string): void {
		const p = this.which?.plan({ task });
		this.which = null;
		void this.perform(p?.action ?? null);
	}

	cancelWhich(): void {
		this.which = null;
		this.#d.announce(W.rebalance.cancelled);
	}
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's keyboard model and the commands behind its menus (phase-2.md 7.1, 10.2): every
 * gesture has a key, and each ends in one dispatched `GanttAction`, exactly like its pointer
 * twin, so the text patch, the toast and the undo step are the same. The keys are `lib/gantt/
 * keys.ts`; this file is what they do, for the row that has the focus.
 *
 * - **Nudges** (R1 size, R2 move): each press adds a step to the gesture's total and the
 *   dispatcher gets the cumulative total, coalesced (`Nudges`). The ghost shows where the bar
 *   will go (`preview.ts`) until the dispatcher applies it after a pause, on Enter, or when the
 *   focus leaves the row: one undo step per burst.
 * - **Modes** (R3 link, R9 progress): L and P start a mode that owns the arrows, Enter and Escape
 *   until it ends; both announce themselves and each change in the Gantt's live region.
 * - **Rows** (R5): reorder, indent and outdent through `stepTarget`; rename (R8, F2); add after,
 *   delete (extra); today (R10).
 * - **People** (R6): `book` toggles a person on a task, the palette's key path.
 * Over 400 lines on purpose: the commands share one set of modes (link, progress, rename) and one
 * burst table, and each reads the others' state; the key maps and the row maths are in lib/gantt.
 * The menu in the toolbar calls `perform`, the same commands for a mouse or a finger that cannot
 * drag (WCAG 2.5.7).
 */
import type { ScheduleResult } from '../../engine/protocol';
import { clampPercent, snapPercent } from '../../lib/gantt/handles';
import {
	commandFor,
	linkKey,
	progressKey,
	type GanttCommand,
	type KeyEventLike,
} from '../../lib/gantt/keys';
import type { ActionContext } from '../../lib/gantt/intents';
import { resizeEdge } from '../../lib/gantt/intents';
import type { GanttModel } from '../../lib/gantt/model';
import { Nudges } from '../../lib/gantt/nudge';
import {
	clampDays,
	ghostForMove,
	ghostForResize,
	resizeRef,
	type MoveEnv,
} from '../../lib/gantt/preview';
import { placeNow, rootsOf, stepTarget, type Step, type Tree } from '../../lib/gantt/reorder';
import type { WorkingTime } from '../../lib/schedule/working-time';
import type { AppState } from '../../lib/state/app.svelte';
import type { ActionSource, DispatchOutcome } from '../../lib/state/edits.svelte';
import { movedId } from '../../lib/state/edits.svelte';
import { gestureStrings } from '../../lib/strings';
import { earliestStart, latestEnd } from '../../lib/gantt/intents';
import { GanttActor } from './actor.svelte';
import { LinkMode } from './link-mode.svelte';

export interface InteractionHost {
	readonly app: AppState;
	model(): GanttModel;
	/** What the Gantt draws, as the action's source. */
	shown(): ActionSource;
	ctx(): ActionContext | null;
	wt(): WorkingTime | null;
	/** Scrolls a row into view. */
	reveal(row: number): Promise<void>;
	/** Scrolls to today; false when it is not on the chart. */
	today(): boolean;
	/** Puts the keyboard focus on a row once it exists (a reparented row has a new key). */
	focusRowSoon(key: string): void;
	announce(text: string): void;
}

export interface ProgressMode {
	readonly key: string;
	readonly task: string;
	readonly name: string;
	readonly percent: number;
}

export class GanttInteractions {
	readonly actor: GanttActor;
	readonly links: LinkMode;
	/** R9's progress mode, or null. */
	progress = $state.raw<ProgressMode | null>(null);
	/** The row being renamed in place (R8), by key, or null. */
	renaming = $state<string | null>(null);
	readonly #h: InteractionHost;
	readonly #nudges: Nudges;

	constructor(host: InteractionHost) {
		this.#h = host;
		this.actor = new GanttActor({ app: host.app, shown: () => host.shown() });
		this.links = new LinkMode({
			model: () => host.model(),
			check: (a) => this.actor.check(a),
			run: (a) => this.actor.run(a),
			announce: (t) => host.announce(t),
		});
		this.#nudges = new Nudges((key) => this.actor.flush(key));
	}

	get #tree(): Tree {
		return this.#h.app.outline.byKey;
	}

	get #roots(): string[] {
		return rootsOf(
			this.#tree,
			this.#h.app.outline.tasks.map((n) => n.key),
		);
	}

	#row(key: string): number {
		return this.#h.model().rowOf.get(key) ?? -1;
	}

	/** A key press in the treegrid on row `key`: true when it was one of ours. */
	key(e: KeyEventLike, key: string): boolean {
		const row = this.#row(key);
		if (row < 0) return false;
		if (this.links.state?.via === 'key') return this.#linkKey(e, row);
		if (this.progress) return this.#progressKey(e);
		if (e.key === 'Enter' || e.key === 'Escape') this.#nudges.end();
		const cmd = commandFor(e);
		if (!cmd) return false;
		void this.perform(cmd, key);
		return true;
	}

	/** The focus moved to another row or out of the grid: bursts and modes end. */
	focusMoved(key: string | null): void {
		this.#nudges.end();
		if (this.progress && this.progress.key !== key) this.#endProgress();
	}

	/** Runs a command on a row (the keys, the menu). */
	async perform(cmd: GanttCommand, key: string): Promise<void> {
		const m = this.#h.model();
		const row = m.rows[this.#row(key)];
		if (!row) return;
		switch (cmd.type) {
			case 'size':
				return this.#size(key, cmd.steps);
			case 'move':
				return this.#move(key, cmd.days);
			case 'reorder':
				await this.reorder(key, cmd.step);
				return;
			case 'link':
				return this.#beginLink(key);
			case 'progress':
				return this.#beginProgress(key);
			case 'today':
				return this.#h.announce(
					this.#h.today() ? gestureStrings.live.today : gestureStrings.live.noToday,
				);
			case 'add':
				return this.add(key);
			case 'delete':
				return this.remove(key);
		}
	}

	// --- R1, R2: nudges -----------------------------------------------------------------------

	#moveEnv(row: number): MoveEnv | null {
		const r = this.#h.model().rows[row];
		const ctx = this.#h.ctx();
		if (!r?.id || r.start === null || r.end === null) return null;
		const alap = !!ctx && resizeEdge(r.id, ctx) === 'start';
		return {
			wt: this.#h.wt(),
			row: r,
			alap,
			floor: ctx ? earliestStart(r.id, ctx) : null,
			ceiling: ctx ? latestEnd(r.id, ctx) : null,
		};
	}

	async #size(key: string, steps: 1 | -1): Promise<void> {
		const row = this.#row(key);
		const env = this.#moveEnv(row);
		const r = this.#h.model().rows[row];
		if (!env || !r?.id) return void this.#h.announce(gestureStrings.live.nothingToDo);
		const id = `size:${r.id}`;
		const total = this.#nudges.press(id, steps);
		const wt = env.wt;
		// The estimate for the ghost: the free edge by whole working days (the real size follows).
		const ref = resizeRef(wt, r, env.alap);
		const at = wt
			? wt.shiftDays(ref, env.alap ? -total : total, env.alap ? 'start' : 'end')
			: ref + (env.alap ? -total : total) * 1440;
		const ghost = ghostForResize(wt, r, env.alap, at, row);
		const o = await this.actor.run(
			{ type: 'size-step', task: r.id, steps: total },
			{ coalesceKey: id },
			{ task: r.id, start: ghost.start, end: ghost.end },
		);
		this.#after(id, o);
	}

	async #move(key: string, days: 1 | -1): Promise<void> {
		const row = this.#row(key);
		const env = this.#moveEnv(row);
		const r = this.#h.model().rows[row];
		if (!env || !r?.id) return void this.#h.announce(gestureStrings.live.nothingToDo);
		const id = `move:${r.id}`;
		const total = this.#nudges.press(id, days);
		const clamped = clampDays(env, total);
		if (clamped !== total) {
			// At the limit the dependencies set: the press is not counted.
			this.#nudges.press(id, -days);
			return void this.#h.announce(gestureStrings.drag.limit);
		}
		const ghost = ghostForMove(env, total, row);
		const o = await this.actor.run(
			{ type: 'move', task: r.id, days: total },
			{ coalesceKey: id },
			{ task: r.id, start: ghost.start, end: ghost.end },
		);
		this.#after(id, o);
	}

	/** A refused nudge ends its burst: there is nothing held to flush. */
	#after(id: string, o: DispatchOutcome): void {
		if (o.status === 'refused' || o.status === 'ask-move-preference') this.#nudges.forget(id);
	}

	// --- R3: link mode ------------------------------------------------------------------------

	#beginLink(key: string): void {
		const row = this.#row(key);
		// No target yet: the first Down picks the row below.
		if (!this.links.begin(row, 'key')) this.#h.announce(gestureStrings.live.nothingToDo);
	}

	#pick(row: number | null): void {
		this.links.target(row);
		if (row !== null) void this.#h.reveal(row);
	}

	#linkKey(e: KeyEventLike, from: number): boolean {
		const k = linkKey(e);
		if (!k) return false;
		const s = this.links.state;
		const n = this.#h.model().rows.length;
		if (!s) return false;
		const at = s.target ?? s.from;
		const step = (d: number): number | null => {
			let r = at;
			for (let i = 0; i < n; i++) {
				r = (r + d + n) % n;
				if (r !== from) return r;
			}
			return null;
		};
		switch (k) {
			case 'next':
				this.#pick(step(1));
				break;
			case 'previous':
				this.#pick(step(-1));
				break;
			case 'first':
				this.#pick(from === 0 ? (n > 1 ? 1 : null) : 0);
				break;
			case 'last':
				this.#pick(from === n - 1 ? (n > 1 ? n - 2 : null) : n - 1);
				break;
			case 'confirm':
				if (s.target === null) this.#h.announce(gestureStrings.live.nothingToDo);
				else void this.links.complete(s.target);
				break;
			case 'cancel':
				this.links.cancel();
				break;
		}
		return true;
	}

	// --- R9: progress mode --------------------------------------------------------------------

	#beginProgress(key: string): void {
		const r = this.#h.model().rows[this.#row(key)];
		if (!r?.id || r.kind !== 'task' || r.textOnly !== null || !r.scheduled) {
			return void this.#h.announce(gestureStrings.live.nothingToDo);
		}
		const percent = snapPercent(r.complete ?? 0);
		this.progress = { key, task: r.id, name: r.name, percent };
		this.#h.announce(gestureStrings.live.progressStart(r.name, percent));
	}

	#progressKey(e: KeyEventLike): boolean {
		const p = this.progress;
		const k = progressKey(e);
		if (!p || !k) return false;
		if ('done' in k) {
			this.#endProgress();
			return true;
		}
		const percent = clampPercent('to' in k ? k.to : p.percent + k.by);
		if (percent === p.percent) return true;
		this.progress = { ...p, percent };
		this.#h.announce(gestureStrings.live.progressNow(percent));
		const id = `progress:${p.task}`;
		void this.actor
			.run(
				{ type: 'progress', task: p.task, percent },
				{ coalesceKey: id },
				{ task: p.task, start: null, end: null, complete: percent },
			)
			.then((o) => this.#after(id, o));
		return true;
	}

	#endProgress(): void {
		const p = this.progress;
		this.progress = null;
		if (p) this.actor.flush(`progress:${p.task}`);
	}

	// --- R5, R8, extra: rows ------------------------------------------------------------------

	/** One place up or down, one level in or out (the keys and the row menu). */
	async reorder(key: string, step: Step): Promise<DispatchOutcome | null> {
		const node = this.#tree.get(key);
		const place = stepTarget(this.#tree, key, step, this.#roots);
		if (!node?.id || !place) {
			this.#h.announce(gestureStrings.live.noPlace);
			return null;
		}
		return this.moveTo(key, place.parent, place.index);
	}

	/** Dispatches a `reorder`, and gives the focus to the row under its new key. */
	async moveTo(key: string, parent: string | null, index: number): Promise<DispatchOutcome | null> {
		const node = this.#tree.get(key);
		if (!node?.id) return null;
		const o = await this.actor.run({ type: 'reorder', task: node.id, parent, index });
		if (o.status === 'applied') this.#h.focusRowSoon(`task:${movedId(node.id, parent)}`);
		return o;
	}

	startRename(key: string): void {
		this.renaming = key;
	}

	/** Commits the in-place rename (Enter, blur); an unchanged or empty name changes nothing. */
	async finishRename(key: string, name: string): Promise<void> {
		if (this.renaming !== key) return;
		this.renaming = null;
		const r = this.#h.model().rows[this.#row(key)];
		const next = name.trim();
		if (!r?.id || next === '' || next === r.name) return;
		await this.actor.run({ type: 'rename', task: r.id, name: next });
		this.#h.focusRowSoon(key);
	}

	cancelRename(): void {
		const key = this.renaming;
		this.renaming = null;
		if (key) this.#h.focusRowSoon(key);
	}

	async add(key: string): Promise<void> {
		const node = this.#tree.get(key);
		const place = placeNow(this.#tree, key, this.#roots);
		if (!node || !place) return;
		await this.actor.run({
			type: 'add',
			parent: place.parent,
			index: place.index + 1,
			name: gestureStrings.row.newTask,
		});
	}

	/** Delete: the selected link when one is, else the task. */
	async remove(key: string): Promise<void> {
		const sel = this.#h.app.inspector.link;
		if (sel) {
			const link = this.#h.model().links.find((l) => l.pred === sel.pred && l.succ === sel.succ);
			if (link) await this.actor.run({ type: 'unlink', link });
			return;
		}
		await this.deleteTask(key);
	}

	/** Deletes the task (the row menu). */
	async deleteTask(key: string): Promise<void> {
		const r = this.#h.model().rows[this.#row(key)];
		if (r?.id) await this.actor.run({ type: 'delete', task: r.id });
	}

	/** Books a person on a task, or releases them when they are already booked (R6). */
	async book(
		task: string,
		person: string,
		name: string,
		booked: boolean,
	): Promise<DispatchOutcome> {
		const o = await this.actor.run({
			type: booked ? 'unassign' : 'assign',
			task,
			resource: person,
		});
		if (o.status === 'applied') {
			const t = this.#h.model().rows.find((r) => r.id === task)?.name ?? task;
			this.#h.announce(
				booked ? gestureStrings.live.released(name, t) : gestureStrings.live.assigned(name, t),
			);
		}
		return o;
	}

	/** Drops a person chip on a row (the palette's drag). */
	async assign(row: number, person: string): Promise<DispatchOutcome> {
		const r = this.#h.model().rows[row];
		if (!r?.id) return { status: 'cancelled' };
		return this.actor.run({ type: 'assign', task: r.id, resource: person });
	}

	dispose(): void {
		this.#nudges.dispose();
	}
}

/** The shown result's resources by id, for avatars: the plan's own order. */
export function resourceOrder(result: ScheduleResult | null): ReadonlyMap<string, number> {
	return new Map((result?.resources ?? []).map((r, i) => [r.id, i] as const));
}

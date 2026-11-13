// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The edit dispatcher's ledger (edits.svelte.ts; phase-2.md 6.8 step 5, 11.2): the applied edits
 * that have not settled yet, their pending bars and renames (`pending`, a rune the views read),
 * and how each settles. Settling resolves the edit's `settled` promise once, updates its toast and
 * its bar:
 * - `scheduled`, `new-error` (it schedules: the bar follows the new result), `undone`, `replaced`
 *   and `dropped` drop the bar;
 * - `not-scheduled` and `failed` mark it "not scheduled" until the plan schedules again or the
 *   toast closes.
 */
import type { TaskId } from '../tjp/index';
import type { RunnerState } from '../workspace/run-types';
import { settleOf, type Settlement } from './edits-settle';
import type { PendingEdits, PendingMark } from './edits-types';
import { PendingBars } from './pending-bars';
import type { Toasts } from './toasts.svelte';

export interface Entry {
	/** The call that applied it (owns its bar). */
	readonly seq: number;
	/** The history entry. */
	readonly entry: string;
	/** The workspace version it produced. */
	readonly version: number;
	/** The error ids of the good run before it (edits-settle.ts). */
	readonly baseline: ReadonlySet<string>;
	readonly toast: number;
	readonly task: TaskId | null;
	readonly rename: readonly [TaskId, TaskId] | null;
}

interface Open extends Entry {
	readonly resolve: (s: Settlement) => void;
}

const NONE: PendingEdits = { byTask: new Map(), renames: new Map(), count: 0 };

export class Ledger {
	#pending = $state.raw<PendingEdits>(NONE);
	readonly #toasts: Toasts;
	readonly #bars = new PendingBars();
	readonly #open: Open[] = [];

	constructor(toasts: Toasts) {
		this.#toasts = toasts;
	}

	get pending(): PendingEdits {
		return this.#pending;
	}

	/** A call's preview (before it applies), or its bar once applied. */
	bar(mark: PendingMark, state: 'preview' | 'pending', seq: number, toast?: number): void {
		this.#bars.set(mark, state, seq, toast ?? null);
		this.#publish();
	}

	/** The call ended without an edit: its preview goes. */
	dropBar(task: TaskId | undefined, seq: number): void {
		if (this.#bars.drop(task, seq)) this.#publish();
	}

	/** An applied edit; settles at once when `state` already says how (the engine is down). */
	add(e: Entry, state: RunnerState | null): Promise<Settlement> {
		let resolve: (s: Settlement) => void = () => undefined;
		const settled = new Promise<Settlement>((r) => (resolve = r));
		const open: Open = { ...e, resolve };
		this.#open.push(open);
		this.#publish();
		const st = state && settleOf(state, e.version, e.baseline);
		if (st) this.#settle(open, st);
		return settled;
	}

	onRunner(s: RunnerState): void {
		for (const e of [...this.#open]) {
			const st = settleOf(s, e.version, e.baseline);
			if (st) this.#settle(e, st);
		}
		// The plan schedules again: bars marked "not scheduled" go back to normal.
		if (s.latest?.result.ok && !s.outdated && this.#bars.clearNotScheduled()) this.#publish();
	}

	/** The history undid `entry` (the redo stack's top): `replaced` when the dispatcher did. */
	undone(entry: string, replaced: boolean): void {
		for (const e of [...this.#open]) {
			if (e.entry === entry) this.#settle(e, { status: replaced ? 'replaced' : 'undone' });
		}
	}

	/** A toast closed: a bar it marked "not scheduled" goes back to normal. */
	closed(toast: number): void {
		if (this.#bars.clearNotScheduled(toast)) this.#publish();
	}

	/** The plan closes: everything open settles as `dropped`, and the bars go. */
	dispose(): void {
		for (const e of [...this.#open]) this.#settle(e, { status: 'dropped' });
		this.#bars.clear();
		this.#publish();
	}

	#settle(e: Open, st: Settlement): void {
		const i = this.#open.indexOf(e);
		if (i < 0) return;
		this.#open.splice(i, 1);
		e.resolve(st);
		if (st.status === 'not-scheduled' || st.status === 'failed') {
			this.#bars.notScheduled(e.task, e.seq);
		} else {
			this.#bars.drop(e.task, e.seq);
		}
		this.#toasts.settle(e.toast, st);
		this.#publish();
	}

	#publish(): void {
		const renames = new Map<TaskId, TaskId>();
		for (const e of this.#open) if (e.rename) renames.set(e.rename[0], e.rename[1]);
		this.#pending = { byTask: this.#bars.snapshot(), renames, count: this.#open.length };
	}
}

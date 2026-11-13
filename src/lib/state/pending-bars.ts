// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The edit dispatcher's pending bars (edits.svelte.ts; phase-2.md 6.8, 7.3, 11.2): per task, the
 * preview geometry of the newest call that has one, and its state (`PendingBarState`). Each bar
 * remembers the call that set it (`owner`), so an older call that ends never takes a newer call's
 * bar, and the toast of its edit, so closing that toast clears a "not scheduled" mark.
 */
import type { TaskId } from '../tjp/index';
import type { PendingBar, PendingBarState, PendingMark } from './edits-types';

interface Bar {
	readonly bar: PendingBar;
	readonly owner: number;
	readonly toast: number | null;
}

export class PendingBars {
	readonly #bars = new Map<TaskId, Bar>();

	/** The bars as views read them. */
	snapshot(): ReadonlyMap<TaskId, PendingBar> {
		const out = new Map<TaskId, PendingBar>();
		for (const [task, b] of this.#bars) out.set(task, b.bar);
		return out;
	}

	/** Sets a preview (any call), or marks it pending (only while `owner` still has it). */
	set(mark: PendingMark, state: PendingBarState, owner: number, toast: number | null = null): void {
		const cur = this.#bars.get(mark.task);
		if (state !== 'preview' && cur && cur.owner !== owner) return;
		this.#bars.set(mark.task, { bar: { mark, state }, owner, toast });
	}

	/** The call ended without an edit, or its edit scheduled or was undone: the bar goes. */
	drop(task: TaskId | undefined | null, owner: number): boolean {
		if (task === undefined || task === null || this.#bars.get(task)?.owner !== owner) return false;
		return this.#bars.delete(task);
	}

	/** The call's edit does not schedule: back to its last good place, marked (11.2). */
	notScheduled(task: TaskId | null, owner: number): boolean {
		const b = task === null ? undefined : this.#bars.get(task);
		if (task === null || !b || b.owner !== owner) return false;
		this.#bars.set(task, { ...b, bar: { ...b.bar, state: 'not-scheduled' } });
		return true;
	}

	/** Clears "not scheduled" marks: every one, or the one of a toast that closed. */
	clearNotScheduled(toast?: number): boolean {
		let changed = false;
		for (const [task, b] of [...this.#bars]) {
			if (b.bar.state !== 'not-scheduled' || (toast !== undefined && b.toast !== toast)) continue;
			this.#bars.delete(task);
			changed = true;
		}
		return changed;
	}

	clear(): void {
		this.#bars.clear();
	}
}

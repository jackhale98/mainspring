// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The edit toasts' list (phase-2.md 6.8, 9.4, 11.2), for the dispatcher (edits.svelte.ts), which
 * owns one, and `Toasts.svelte`, which draws it in a polite live region.
 *
 * - One toast per edit: its label while the engine reschedules (`pending`), then `scheduled`. It
 *   closes `TOAST_MS` after it settles, so a slow engine never makes it vanish unsettled, and it
 *   always settles (the dispatcher's contract), so it never hangs.
 * - "Changed. The plan no longer schedules: ..." (`not-scheduled`), a failed run (`failed`), a
 *   refusal and the one-time constraint warning stay until dismissed.
 * - `canUndo` is true only while the toast's entry is the top of the history (ADR-0008); an entry
 *   that is undone closes its toast (the app's note says "Undone: ...").
 * - At most `MAX_TOASTS` are kept: the oldest goes first.
 */
import { toastStrings } from '../strings';
import type { ToastLabel } from '../gantt/intents';
import type { KeyTimers } from '../tjp/cm/android-key';
import type { Located, Settlement } from './edits-settle';

export type ToastStatus = 'pending' | 'scheduled' | 'not-scheduled' | 'failed' | 'refused' | 'noop';

export interface Toast {
	readonly id: number;
	readonly status: ToastStatus;
	/** The main line: the edit's label, or what went wrong. */
	readonly text: string;
	/** A second line: "Rescheduling…", or the edit's label under a problem. */
	readonly detail: string | null;
	/** The label has a rounded value ("about"). */
	readonly approx: boolean;
	/** The one-time constraint warning. */
	readonly warning: string | null;
	/** The history entry this toast can undo. */
	readonly entry: string | null;
	readonly canUndo: boolean;
	/** Where "Show" goes, in the text of `show.version`. */
	readonly show: Located | null;
	/** Stays until dismissed. */
	readonly sticky: boolean;
}

/** How long a settled edit's toast stays. */
export const TOAST_MS = 6000;
export const MAX_TOASTS = 3;

export class Toasts {
	#list = $state.raw<readonly Toast[]>([]);
	readonly #timers: KeyTimers;
	readonly #onClose: (t: Toast) => void;
	readonly #closing = new Map<number, unknown>();
	#id = 0;
	#top: string | null = null;

	/** `onClose` hears every toast that closes, by timer, by `remove` or because it was undone. */
	constructor(timers: KeyTimers, onClose: (t: Toast) => void = () => undefined) {
		this.#timers = timers;
		this.#onClose = onClose;
	}

	get list(): readonly Toast[] {
		return this.#list;
	}

	get(id: number): Toast | null {
		return this.#list.find((t) => t.id === id) ?? null;
	}

	/** An applied edit, pending until it settles; returns its id. */
	edit(label: ToastLabel, entry: string, warning: string | null): number {
		return this.#add({
			status: 'pending',
			text: label.text,
			detail: toastStrings.rescheduling,
			approx: label.approx,
			warning,
			entry,
			canUndo: entry === this.#top,
			show: null,
			sticky: warning !== null,
		});
	}

	refused(message: string, show: Located | null): number {
		return this.#add({ ...BLANK, status: 'refused', text: message, show, sticky: true });
	}

	noop(message: string): number {
		const id = this.#add({ ...BLANK, status: 'noop', text: message });
		this.#arm(id);
		return id;
	}

	settle(id: number, st: Settlement): void {
		const t = this.get(id);
		if (!t) return;
		const label = t.status === 'pending' ? t.text : t.detail;
		switch (st.status) {
			case 'scheduled':
				this.#set({ ...t, status: 'scheduled', detail: null });
				if (!t.sticky) this.#arm(id);
				return;
			case 'not-scheduled':
				this.#disarm(id);
				this.#set({
					...t,
					status: st.status,
					text: st.message,
					detail: label,
					show: st.at,
					sticky: true,
				});
				return;
			case 'failed':
				this.#disarm(id);
				this.#set({ ...t, status: 'failed', text: st.message, detail: label, sticky: true });
				return;
			default:
				this.remove(id);
		}
	}

	/** The history's top entry changed: only its toast can undo. */
	setTop(top: string | null): void {
		this.#top = top;
		const next = this.#list.map((t) => {
			const canUndo = t.entry !== null && t.entry === top;
			return canUndo === t.canUndo ? t : { ...t, canUndo };
		});
		if (next.some((t, i) => t !== this.#list[i])) this.#list = next;
	}

	/** The entry was undone: its toast closes. */
	removeEntry(entry: string): void {
		for (const t of this.#list) if (t.entry === entry) this.remove(t.id);
	}

	remove(id: number): void {
		const t = this.get(id);
		if (!t) return;
		this.#disarm(id);
		this.#list = this.#list.filter((x) => x.id !== id);
		this.#onClose(t);
	}

	clear(): void {
		for (const id of [...this.#closing.keys()]) this.#disarm(id);
		this.#list = [];
	}

	#add(t: Omit<Toast, 'id'>): number {
		const id = ++this.#id;
		this.#list = [...this.#list, { ...t, id }];
		while (this.#list.length > MAX_TOASTS) {
			const old = this.#list[0];
			if (old) this.remove(old.id);
		}
		return id;
	}

	#set(t: Toast): void {
		this.#list = this.#list.map((x) => (x.id === t.id ? t : x));
	}

	#arm(id: number): void {
		this.#disarm(id);
		this.#closing.set(
			id,
			this.#timers.setTimeout(() => {
				this.#closing.delete(id);
				this.remove(id);
			}, TOAST_MS),
		);
	}

	#disarm(id: number): void {
		const h = this.#closing.get(id);
		if (h === undefined) return;
		this.#timers.clearTimeout(h);
		this.#closing.delete(id);
	}
}

const BLANK: Omit<Toast, 'id' | 'status' | 'text'> = {
	detail: null,
	approx: false,
	warning: null,
	entry: null,
	canUndo: false,
	show: null,
	sticky: false,
};

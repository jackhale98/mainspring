// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Keyboard nudges as gestures (phase-2.md 6.8 step 6, 19.7; edits.svelte.ts "Coalescing"): each
 * key press adds a step to the total of its gesture, and the dispatcher is sent the cumulative
 * total, never the step. A gesture ends on Enter, on the focus leaving the row, after a refusal,
 * or after a pause (`IDLE_MS`, as the inspector's steppers do), when the held call is flushed
 * and the next press starts a new total. One gesture is one undo step.
 */

export const IDLE_MS = 1200;

export interface NudgeTimers {
	set(fn: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

const global: NudgeTimers = {
	set: (fn, ms) => globalThis.setTimeout(fn, ms),
	clear: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
};

interface Burst {
	total: number;
	timer: unknown;
}

export class Nudges {
	readonly #bursts = new Map<string, Burst>();
	readonly #end: (key: string) => void;
	readonly #timers: NudgeTimers;
	readonly #idle: number;

	/** `end` is called with the key when its gesture is over: flush the dispatcher's. */
	constructor(end: (key: string) => void, timers: NudgeTimers = global, idleMs = IDLE_MS) {
		this.#end = end;
		this.#timers = timers;
		this.#idle = idleMs;
	}

	/** Adds a step to the gesture `key`; the cumulative total since it began. */
	press(key: string, step: number): number {
		const b = this.#bursts.get(key) ?? { total: 0, timer: null };
		b.total += step;
		if (b.timer !== null) this.#timers.clear(b.timer);
		b.timer = this.#timers.set(() => this.end(key), this.#idle);
		this.#bursts.set(key, b);
		return b.total;
	}

	total(key: string): number {
		return this.#bursts.get(key)?.total ?? 0;
	}

	/** Ends the gesture of `key`, or every gesture: the held call goes now. */
	end(key?: string): void {
		for (const k of key === undefined ? [...this.#bursts.keys()] : [key]) {
			const b = this.#bursts.get(k);
			if (!b) continue;
			if (b.timer !== null) this.#timers.clear(b.timer);
			this.#bursts.delete(k);
			this.#end(k);
		}
	}

	/** Forgets a gesture without flushing it (its call was refused: there is nothing held). */
	forget(key: string): void {
		const b = this.#bursts.get(key);
		if (b?.timer != null) this.#timers.clear(b.timer);
		this.#bursts.delete(key);
	}

	dispose(): void {
		for (const b of this.#bursts.values()) if (b.timer !== null) this.#timers.clear(b.timer);
		this.#bursts.clear();
	}
}

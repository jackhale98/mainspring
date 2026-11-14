// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Coalesced calls of the edit dispatcher (edits.svelte.ts; phase-2.md 6.8 step 6, 19.7): per
 * `coalesceKey`, the newest held call and the gesture it belongs to.
 *
 * A gesture is everything sent with one key from its first call until `end(key)` (the dispatcher's
 * `flush(key)`: blur, Enter). Every call carries the cumulative total since the gesture began. The
 * gesture remembers the text before its first edit (`base`) and its edit in the text now
 * (`applied`), so that a newer total replaces that edit instead of adding to it: the gesture is
 * one undo step whatever the timing. When something else becomes the newest undo step meanwhile,
 * the gesture is `broken` and its further calls are refused until it ends.
 */
import type { KeyTimers } from '../tjp/cm/android-key';
import type { Base } from './edits-plan';
import type { ActionSource } from './edits-types';

export interface Gesture {
	/** The text and index before the gesture's first edit, for dry runs of a newer total. */
	base: Base | null;
	/** The history entry of the gesture's edit in the text now, or null. */
	applied: string | null;
	broken: boolean;
	/**
	 * The result an action gesture is planned against, pinned by its first call: a burst of
	 * nudges that began on one schedule keeps planning on it, whatever result arrives meanwhile
	 * (+3 days, a result, one more press is +4 on the schedule the gesture began on, not +4 on the
	 * moved task).
	 */
	source?: ActionSource;
}

export interface Held<J, R> {
	readonly key: string;
	readonly job: J;
	readonly resolve: (r: R) => void;
	readonly timer: unknown;
}

export class Coalescer<J, R> {
	readonly #held = new Map<string, Held<J, R>>();
	readonly #gestures = new Map<string, Gesture>();
	readonly #timers: KeyTimers;
	readonly #quietMs: number;
	readonly #onQuiet: (key: string) => void;

	constructor(timers: KeyTimers, quietMs: number, onQuiet: (key: string) => void) {
		this.#timers = timers;
		this.#quietMs = quietMs;
		this.#onQuiet = onQuiet;
	}

	/** The gesture of `key`, begun now if none is open. */
	gesture(key: string): Gesture {
		let g = this.#gestures.get(key);
		if (!g) this.#gestures.set(key, (g = { base: null, applied: null, broken: false }));
		return g;
	}

	/** Holds the newest call of `key` until `quietMs` of quiet; returns the call it replaced. */
	hold(key: string, job: J, resolve: (r: R) => void): Held<J, R> | null {
		const prev = this.#held.get(key) ?? null;
		if (prev) this.#timers.clearTimeout(prev.timer);
		const timer = this.#timers.setTimeout(() => this.#onQuiet(key), this.#quietMs);
		this.#held.set(key, { key, job, resolve, timer });
		return prev;
	}

	/** Takes the held call of `key` (every held call when omitted) to dispatch it now. */
	take(key?: string): Array<Held<J, R>> {
		const out: Array<Held<J, R>> = [];
		for (const [k, h] of [...this.#held]) {
			if (key !== undefined && k !== key) continue;
			this.#held.delete(k);
			this.#timers.clearTimeout(h.timer);
			out.push(h);
		}
		return out;
	}

	/** The keys with an open gesture. */
	keys(): string[] {
		return [...this.#gestures.keys()];
	}

	/**
	 * Ends the gesture now: a newer call with the key begins a new one. Calls already taken keep
	 * their own reference to the old gesture.
	 */
	end(key: string): void {
		this.#gestures.delete(key);
	}

	/** Drops everything; returns the held calls so that they can be answered. */
	clear(): Array<Held<J, R>> {
		const out = this.take();
		this.#gestures.clear();
		return out;
	}
}

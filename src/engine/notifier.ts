// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * State change notification for the engine client.
 *
 * Listeners only ever receive the current state. If a listener changes the state while a round
 * is being delivered (for example by calling `schedule()`), the round stops and a new round
 * delivers the newer state to every listener. Changes that happen during delivery are coalesced,
 * so no listener is left holding a stale value.
 */
export class StateNotifier<S> {
	readonly #read: () => S;
	readonly #listeners = new Set<(state: S) => void>();
	#last: S;
	#delivering = false;

	/** `read` returns the current state; the state at construction counts as delivered. */
	constructor(read: () => S) {
		this.#read = read;
		this.#last = read();
	}

	subscribe(listener: (state: S) => void): () => void {
		this.#listeners.add(listener);
		return () => void this.#listeners.delete(listener);
	}

	clear(): void {
		this.#listeners.clear();
	}

	/** Delivers the current state if it changed since the last delivery. Safe to call reentrantly. */
	notify(): void {
		if (this.#delivering) return;
		this.#delivering = true;
		try {
			for (let state = this.#read(); state !== this.#last; state = this.#read()) {
				this.#last = state;
				for (const listener of [...this.#listeners]) {
					if (this.#read() !== state) break;
					if (this.#listeners.has(listener)) deliver(listener, state);
				}
			}
		} finally {
			this.#delivering = false;
		}
	}
}

function deliver<S>(listener: (state: S) => void, state: S): void {
	try {
		listener(state);
	} catch (error) {
		// A broken listener must not break the engine; report it without blocking.
		queueMicrotask(() => {
			throw error;
		});
	}
}

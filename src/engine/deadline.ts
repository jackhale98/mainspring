// SPDX-License-Identifier: GPL-2.0-or-later
/** A restartable one-shot timer, used by the engine client for its boot and reply deadlines. */

/** setTimeout's largest delay; a longer delay would fire at once. */
const MAX_TIMER_MS = 2_147_483_647;

/** Returns `ms` if it is a positive duration (Infinity allowed); throws `RangeError` otherwise. */
export function checkDuration(name: string, ms: number): number {
	if (!(ms > 0)) throw new RangeError(`${name} must be positive, got ${ms}.`);
	return ms;
}

export class Deadline {
	readonly ms: number;
	readonly #onExpire: () => void;
	#handle: ReturnType<typeof setTimeout> | null = null;

	/** A duration above setTimeout's limit, Infinity included, never expires. */
	constructor(ms: number, onExpire: () => void) {
		this.ms = ms;
		this.#onExpire = onExpire;
	}

	get armed(): boolean {
		return this.#handle !== null;
	}

	/** Starts the countdown from now, replacing any running one. */
	start(): void {
		this.stop();
		if (this.ms > MAX_TIMER_MS) return;
		this.#handle = setTimeout(() => {
			this.#handle = null;
			this.#onExpire();
		}, this.ms);
	}

	stop(): void {
		if (this.#handle !== null) clearTimeout(this.#handle);
		this.#handle = null;
	}
}

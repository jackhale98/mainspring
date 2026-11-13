// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * One burst of stepper presses (phase-2.md 6.8 step 6; edits.svelte.ts "Coalescing"). The
 * dispatcher wants the cumulative total since the gesture began, not each step, and the text
 * keeps its value from before the gesture until the edit is replaced, so the stepper shows
 * `base + total` while the burst is held. The burst is held from the first press until the field
 * sees the text change (or the edit is refused), then released.
 */
export class Burst {
	#base: number | null = null;
	#total = 0;
	readonly #min: number;
	readonly #max: number;

	constructor(min = -Infinity, max = Infinity) {
		this.#min = min;
		this.#max = max;
	}

	get held(): boolean {
		return this.#base !== null;
	}

	/** The value from before the burst, or null when none is held. */
	get base(): number | null {
		return this.#base;
	}

	/** The total since the burst began. */
	get total(): number {
		return this.#total;
	}

	/** A press of `step` on a stepper whose text says `current`; the new total (kept in range). */
	press(current: number, step: number): number {
		this.#base ??= current;
		const next = Math.min(this.#max, Math.max(this.#min, this.#base + this.#total + step));
		this.#total = next - this.#base;
		return this.#total;
	}

	release(): void {
		this.#base = null;
		this.#total = 0;
	}
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test-only idle callbacks for the schedule runner (`ScheduleRunnerOptions.timers`): requests
 * queue until the test runs them, one task at a time, so a test sees each idle task the runner
 * asks for and what it published, without advancing any other timer. Not imported by application
 * code.
 */
import type { Timers } from '../run-types';

interface Entry {
	readonly id: number;
	readonly fn: () => void;
	readonly timeoutMs: number;
}

export class IdleQueue {
	readonly #queue: Entry[] = [];
	#next = 1;
	/** How many idle tasks have run. */
	ran = 0;
	/** The timeouts the runner asked for, in order. */
	readonly timeouts: number[] = [];
	cancelled = 0;

	/** The `requestIdle` and `cancelIdle` timers to pass to the runner. */
	readonly timers: Pick<Timers, 'requestIdle' | 'cancelIdle'> = {
		requestIdle: (fn, timeoutMs) => {
			const id = this.#next++;
			this.#queue.push({ id, fn, timeoutMs });
			this.timeouts.push(timeoutMs);
			return id;
		},
		cancelIdle: (handle) => {
			const i = this.#queue.findIndex((e) => e.id === handle);
			if (i >= 0) {
				this.#queue.splice(i, 1);
				this.cancelled++;
			}
		},
	};

	/** Idle tasks asked for and not yet run. */
	get size(): number {
		return this.#queue.length;
	}

	/** Runs the oldest waiting idle task; false when none waits. */
	runOne(): boolean {
		const e = this.#queue.shift();
		if (!e) return false;
		this.ran++;
		e.fn();
		return true;
	}

	/** Runs idle tasks, including those they ask for, until none waits; returns how many ran. */
	run(max = 1000): number {
		let n = 0;
		while (n < max && this.runOne()) n++;
		if (this.#queue.length > 0) throw new Error(`IdleQueue: still busy after ${max} tasks`);
		return n;
	}
}

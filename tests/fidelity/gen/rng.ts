// SPDX-License-Identifier: GPL-2.0-or-later
// A small seeded generator for the fidelity suite. Every case is a function of one integer seed, so
// a failing case replays from `FIDELITY_CASE=<seed>` and from tests/fidelity/regressions.json.

/** mulberry32: 32 bits of state, good enough for test data, and identical on every platform. */
export class Rng {
	private state: number;
	constructor(seed: number) {
		this.state = seed >>> 0;
	}
	/** A number in [0, 1). */
	next(): number {
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	/** An integer in [lo, hi]. */
	int(lo: number, hi: number): number {
		return lo + Math.floor(this.next() * (hi - lo + 1));
	}
	/** True with probability `p`. */
	chance(p: number): boolean {
		return this.next() < p;
	}
	pick<T>(items: readonly T[]): T {
		if (items.length === 0) throw new Error('pick from an empty list');
		return items[Math.floor(this.next() * items.length)] as T;
	}
	/** Up to `n` distinct items, in random order. */
	sample<T>(items: readonly T[], n: number): T[] {
		const copy = [...items];
		const out: T[] = [];
		while (copy.length > 0 && out.length < n) {
			out.push(copy.splice(Math.floor(this.next() * copy.length), 1)[0] as T);
		}
		return out;
	}
}

/** Combines two integers into one seed. */
export function mixSeed(a: number, b: number): number {
	let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
	h ^= h >>> 13;
	h = Math.imul(h, 0x27d4eb2f);
	h ^= h >>> 16;
	return h >>> 0;
}

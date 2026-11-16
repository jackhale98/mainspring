// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Interval-set arithmetic for the workload model (availability.ts, load.ts). An `IntervalSet` is
 * a list of [start, end) minute pairs: ascending, disjoint, touching pairs merged, as the engine
 * sends `bookings`, `workingTime` and `leaves`. Everything here is exact integer arithmetic over
 * engine intervals: no estimate, no schedule (ADR-0007, ADR-0014 #4).
 *
 * The set operations are linear sweeps; `minutesIn` is a binary search; `addBucketSums` walks the
 * set and the bucket bounds together, so a whole row costs O(intervals + buckets).
 */
import type { Minutes } from '../../engine/protocol';
import type { IntervalSet } from './types';

type Pair = readonly [start: Minutes, end: Minutes];

/** Sorts and merges any pairs (overlapping or touching) into a set; empty pairs are dropped. */
export function mergePairs(pairs: Iterable<Pair>): IntervalSet {
	const list = [...pairs].filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const out: Array<[Minutes, Minutes]> = [];
	for (const [s, e] of list) {
		const last = out[out.length - 1];
		if (last && s <= last[1]) {
			if (e > last[1]) last[1] = e;
		} else out.push([s, e]);
	}
	return out;
}

/** a ∪ b. */
export function union(a: IntervalSet, b: IntervalSet): IntervalSet {
	if (b.length === 0) return a;
	if (a.length === 0) return b;
	return mergePairs([...a, ...b]);
}

/** a ∩ b. */
export function intersect(a: IntervalSet, b: IntervalSet): IntervalSet {
	const out: Array<[Minutes, Minutes]> = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const x = a[i] as Pair;
		const y = b[j] as Pair;
		const lo = Math.max(x[0], y[0]);
		const hi = Math.min(x[1], y[1]);
		if (hi > lo) out.push([lo, hi]);
		if (x[1] < y[1]) i++;
		else j++;
	}
	return out;
}

/** a minus b. */
export function subtract(a: IntervalSet, b: IntervalSet): IntervalSet {
	if (b.length === 0) return a;
	const out: Array<[Minutes, Minutes]> = [];
	let j = 0;
	for (const [s0, e] of a) {
		let s = s0;
		while (j < b.length && (b[j] as Pair)[1] <= s) j++;
		let k = j;
		while (k < b.length && (b[k] as Pair)[0] < e) {
			const [bs, be] = b[k] as Pair;
			if (bs > s) out.push([s, bs]);
			s = Math.max(s, be);
			if (s >= e) break;
			k++;
		}
		if (s < e) out.push([s, e]);
	}
	return out;
}

/** The index of the first pair whose end is after `m` (the first that can hold [m, ...)). */
function firstEndingAfter(set: IntervalSet, m: Minutes): number {
	let lo = 0;
	let hi = set.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((set[mid] as Pair)[1] <= m) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** Minutes of the set inside [from, to). */
export function minutesIn(set: IntervalSet, from: Minutes, to: Minutes): number {
	let sum = 0;
	for (let i = firstEndingAfter(set, from); i < set.length; i++) {
		const [s, e] = set[i] as Pair;
		if (s >= to) break;
		sum += Math.min(e, to) - Math.max(s, from);
	}
	return sum;
}

/** Whether the set has any minute inside [from, to). */
export function overlaps(set: IntervalSet, from: Minutes, to: Minutes): boolean {
	const i = firstEndingAfter(set, from);
	return i < set.length && (set[i] as Pair)[0] < to && from < to;
}

/** Total minutes of the set. */
export function totalMinutes(set: IntervalSet): number {
	let sum = 0;
	for (const [s, e] of set) sum += e - s;
	return sum;
}

/**
 * Adds the set's minutes inside each bucket [bounds[i], bounds[i + 1]) to `out[i]`, restricted
 * to [from, to) (the whole axis by default). Minutes outside the bounds are not counted. A pair
 * across a bound is split by minute; the axis's bounds are on the slot grid (axis.ts), so engine
 * intervals, which are whole slots, are never split inside a slot.
 */
export function addBucketSums(
	set: IntervalSet,
	bounds: Int32Array,
	out: Int32Array,
	from: Minutes = -Infinity,
	to: Minutes = Infinity,
): void {
	const count = bounds.length - 1;
	if (count <= 0) return;
	const lo = Math.max(from, bounds[0] as number);
	const hi = Math.min(to, bounds[count] as number);
	if (hi <= lo) return;
	let b = 0;
	for (let i = firstEndingAfter(set, lo); i < set.length; i++) {
		const pair = set[i] as Pair;
		let s = Math.max(pair[0], lo);
		const e = Math.min(pair[1], hi);
		if (s >= hi) break;
		while ((bounds[b + 1] as number) <= s) b++;
		while (s < e) {
			const end = Math.min(e, bounds[b + 1] as number);
			out[b] = (out[b] as number) + (end - s);
			s = end;
			if (s < e) b++;
		}
	}
}

/** The set's minutes per bucket, as a new array. */
export function bucketSums(set: IntervalSet, bounds: Int32Array): Int32Array {
	const out = new Int32Array(Math.max(bounds.length - 1, 0));
	addBucketSums(set, bounds, out);
	return out;
}

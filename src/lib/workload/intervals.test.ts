// SPDX-License-Identifier: GPL-2.0-or-later
// Interval-set arithmetic of the workload model: examples, then properties against a
// minute-by-minute model (a set of minutes), which shares no code with intervals.ts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	addBucketSums,
	bucketSums,
	intersect,
	mergePairs,
	minutesIn,
	overlaps,
	subtract,
	totalMinutes,
	union,
} from './intervals';
import type { IntervalSet } from './types';

describe('interval sets', () => {
	it('merges overlapping and touching pairs and drops empty ones', () => {
		expect(
			mergePairs([
				[10, 20],
				[0, 5],
				[5, 8],
				[15, 30],
				[40, 40],
			]),
		).toEqual([
			[0, 8],
			[10, 30],
		]);
	});

	it('unites, intersects and subtracts', () => {
		const a: IntervalSet = [
			[0, 10],
			[20, 30],
		];
		const b: IntervalSet = [
			[5, 25],
			[28, 40],
		];
		expect(union(a, b)).toEqual([[0, 40]]);
		expect(intersect(a, b)).toEqual([
			[5, 10],
			[20, 25],
			[28, 30],
		]);
		expect(subtract(a, b)).toEqual([
			[0, 5],
			[25, 28],
		]);
		expect(subtract(b, a)).toEqual([
			[10, 20],
			[30, 40],
		]);
		expect(subtract(a, [])).toBe(a);
	});

	it('counts minutes in a range and tells whether a range is touched', () => {
		const a: IntervalSet = [
			[0, 10],
			[20, 30],
		];
		expect(minutesIn(a, 5, 25)).toBe(10);
		expect(minutesIn(a, 10, 20)).toBe(0);
		expect(minutesIn(a, -100, 100)).toBe(20);
		expect(overlaps(a, 10, 20)).toBe(false);
		expect(overlaps(a, 9, 20)).toBe(true);
		expect(overlaps(a, 25, 25)).toBe(false);
		expect(totalMinutes(a)).toBe(20);
	});

	it('sums per bucket, splitting pairs at the bounds and leaving out what lies outside', () => {
		const bounds = Int32Array.from([-60, 100, 200, 300]);
		const set: IntervalSet = [
			[0, 50],
			[90, 210],
			[290, 400],
		];
		expect([...bucketSums(set, bounds)]).toEqual([60, 100, 20]);
		const out = new Int32Array(3);
		addBucketSums(set, bounds, out, 95, 205);
		expect([...out]).toEqual([5, 100, 5]);
		expect([...bucketSums(set, Int32Array.of(0))]).toEqual([]);
	});
});

/** A random interval set over [0, 300): sorted cut points paired up. */
const sets = fc
	.uniqueArray(fc.integer({ min: 0, max: 300 }), { maxLength: 12 })
	.map((cuts): IntervalSet => {
		const c = [...cuts].sort((a, b) => a - b);
		const out: Array<[number, number]> = [];
		for (let i = 0; i + 1 < c.length; i += 2) out.push([c[i] as number, c[i + 1] as number]);
		return mergePairs(out);
	});

const minutes = (s: IntervalSet): Set<number> => {
	const out = new Set<number>();
	for (const [a, b] of s) for (let m = a; m < b; m++) out.add(m);
	return out;
};
const fromMinutes = (m: Set<number>): IntervalSet =>
	mergePairs([...m].sort((a, b) => a - b).map((x): [number, number] => [x, x + 1]));

describe('interval set properties', () => {
	it('match the minute-by-minute model', () => {
		fc.assert(
			fc.property(sets, sets, (a, b) => {
				const ma = minutes(a);
				const mb = minutes(b);
				expect(union(a, b)).toEqual(fromMinutes(new Set([...ma, ...mb])));
				expect(intersect(a, b)).toEqual(fromMinutes(new Set([...ma].filter((x) => mb.has(x)))));
				expect(subtract(a, b)).toEqual(fromMinutes(new Set([...ma].filter((x) => !mb.has(x)))));
			}),
		);
	});

	it('bucket sums add up to the minutes inside the bounds, whatever the bounds', () => {
		fc.assert(
			fc.property(
				sets,
				fc.uniqueArray(fc.integer({ min: -20, max: 320 }), { minLength: 2, maxLength: 10 }),
				(set, cuts) => {
					const bounds = Int32Array.from([...cuts].sort((a, b) => a - b));
					const sums = bucketSums(set, bounds);
					const lo = bounds[0] as number;
					const hi = bounds[bounds.length - 1] as number;
					expect(sums.reduce((n, v) => n + v, 0)).toBe(minutesIn(set, lo, hi));
					sums.forEach((v, i) => {
						expect(v).toBe(minutesIn(set, bounds[i] as number, bounds[i + 1] as number));
					});
				},
			),
		);
	});
});

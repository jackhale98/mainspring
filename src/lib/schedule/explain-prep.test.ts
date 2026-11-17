// SPDX-License-Identifier: GPL-2.0-or-later
// The result-wide tables of the explainer (explain-prep.ts): global leaves as the scoreboard
// paints them, the interval clip, group expansion, merged task bookings, the cache and the rebuild
// of an availability of another result.
import { describe, expect, it, vi } from 'vitest';
import { availabilityOf } from '../workload/availability';
import { clip, globalTypeAt, paintGlobalLeaves, prepOf } from './explain-prep';
import { goldenContext } from './explain-testing';
import { project } from './testing';

const D = 1440;

describe('paintGlobalLeaves', () => {
	it('puts the later leave on top where two overlap (initScoreboard order)', () => {
		const p = project({
			leaves: [
				{ type: 'holiday', name: null, interval: [4 * D, 8 * D] },
				{ type: 'special', name: null, interval: [7 * D, 9 * D] },
			],
		});
		expect(paintGlobalLeaves(p)).toEqual([
			{ from: 4 * D, to: 7 * D, type: 'holiday' },
			{ from: 7 * D, to: 9 * D, type: 'special' },
		]);
		const reversed = project({
			leaves: [
				{ type: 'special', name: null, interval: [7 * D, 9 * D] },
				{ type: 'holiday', name: null, interval: [4 * D, 8 * D] },
			],
		});
		expect(paintGlobalLeaves(reversed)).toEqual([
			{ from: 4 * D, to: 8 * D, type: 'holiday' },
			{ from: 8 * D, to: 9 * D, type: 'special' },
		]);
	});

	it('truncates to the slot grid and clamps into the frame, leaving the last slot out', () => {
		const p = project({
			timingResolutionMin: 60,
			leaves: [
				{ type: 'holiday', name: null, interval: [-D, 30] },
				{ type: 'annual', name: null, interval: [100, 1e9] },
			],
		});
		const end = (Date.parse(p.end) - Date.parse(p.start)) / 60_000;
		expect(paintGlobalLeaves(p)).toEqual([{ from: 60, to: end - 60, type: 'annual' }]);
	});

	it('is empty without global leaves', () => {
		expect(paintGlobalLeaves(project())).toEqual([]);
	});
});

describe('globalTypeAt', () => {
	const pieces = [
		{ from: 10, to: 20, type: 'holiday' as const },
		{ from: 20, to: 30, type: 'special' as const },
		{ from: 40, to: 50, type: 'annual' as const },
	];
	it('finds the piece holding the minute', () => {
		expect([9, 10, 19, 20, 29, 30, 45, 50].map((m) => globalTypeAt(pieces, m))).toEqual([
			null,
			'holiday',
			'holiday',
			'special',
			'special',
			null,
			'annual',
			null,
		]);
	});
});

describe('clip', () => {
	const set = [
		[0, 10],
		[20, 30],
		[40, 50],
	] as const;
	it('cuts the set to the window', () => {
		expect(clip(set, 5, 45)).toEqual([
			[5, 10],
			[20, 30],
			[40, 45],
		]);
		expect(clip(set, 10, 20)).toEqual([]);
		expect(clip(set, 25, 26)).toEqual([[25, 26]]);
		expect(clip(set, 60, 70)).toEqual([]);
		expect(clip([], 0, 10)).toEqual([]);
	});
});

describe('prepOf', () => {
	it('expands a group to its leaf members and merges a task over its people', () => {
		const ctx = goldenContext('workload-group-allocation');
		const prep = prepOf(ctx);
		expect(prep.leavesOf('team')).toEqual(['m1', 'm2']);
		expect(prep.leavesOf('m1')).toEqual(['m1']);
		expect(prep.leavesOf('nobody')).toEqual([]);
		// m1 and m2 are booked on the same slots: merged once.
		expect(prep.booked('work.triage')).toEqual([
			[540, 1020],
			[1980, 2460],
		]);
		expect(prep.own('m2', 'work.triage')).toEqual([
			[540, 1020],
			[1980, 2460],
		]);
		expect(prep.own('solo', 'work.triage')).toEqual([]);
		expect(prep.containers.has('work')).toBe(true);
		expect(prep.containers.has('work.triage')).toBe(false);
	});

	it('is made once per result and scenario, and again for another result', () => {
		const ctx = goldenContext('workload-held-effort');
		expect(prepOf(ctx)).toBe(prepOf({ ...ctx }));
		expect(prepOf(ctx).availability).toBe(ctx.availability);
		const other = { ...ctx, result: { ...ctx.result } };
		expect(prepOf(other)).not.toBe(prepOf(ctx));
		expect(prepOf(other).result).toBe(other.result);
	});

	it('rebuilds an availability of another revision, and warns in development (F5)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const ctx = goldenContext('workload-held-effort');
			const result = { ...ctx.result, revision: 2 };
			const stale = availabilityOf({ ...result, bookings: [], revision: 1 }, ctx.scenario);
			const prep = prepOf({ ...ctx, result, availability: stale });
			expect(prep.availability).not.toBe(stale);
			expect(prep.availability.revision).toBe(2);
			// The rebuilt one has dev's bookings; the stale one had none.
			expect(prep.availability.people.get('dev')?.booked.length).toBeGreaterThan(0);
			expect(import.meta.env.DEV).toBe(true);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0]?.[0])).toContain('revision 1 (plan) for result 2');
		} finally {
			warn.mockRestore();
		}
	});
});

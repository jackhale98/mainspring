// SPDX-License-Identifier: GPL-2.0-or-later
// The bucket axis (phase-3.md 6.2, 13.1): days, weeks and months in the plan's zone, DST weeks of
// 167 and 169 hours (syn-09, Berlin), New York's gap and overlap (syn-21), Kathmandu's +05:45
// (syn-10), Sydney (syn-11), both week starts, a Sunday start, months, `indexOf`, bounds snapped
// to the slot grid (Kathmandu at a 60-minute resolution), and the host calls (one per 7 days, on
// the plain host and through the Gantt's memo). Expected bounds are worked out by hand;
// `localCheck` reads every bound back with `Intl`, which shares no code with axis.ts or civil.ts.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ProjectInfo, ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { ROOT } from '../../../tests/grammar/corpus';
import { memoZones } from '../gantt/zones';
import { project } from '../schedule/testing';
import type { ZoneOffsets } from '../tjp/values/civil';
import { bucketAxis, frameEndOf, gridZones } from './axis';
import { bucketSums } from './intervals';
import type { BucketAxis, BucketKind } from './types';

const zones = createTimeZoneHost();
const H = 60;
const D = 1440;

function goldenProject(id: string): ProjectInfo {
	const g = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${id}.json`), 'utf8'),
	) as { result: ScheduleResult };
	if (!g.result.project) throw new Error(`${id} has no project`);
	return g.result.project;
}

const lengths = (a: BucketAxis): number[] =>
	[...a.bounds].slice(1).map((b, i) => b - (a.bounds[i] as number));

/** The local date and time of a minute of the frame, by Intl. */
function local(p: ProjectInfo, m: number) {
	const f = new Intl.DateTimeFormat('en-US', {
		timeZone: p.timezone ?? 'UTC',
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		weekday: 'short',
	});
	const parts = Object.fromEntries(
		f.formatToParts(new Date(Date.parse(p.start) + m * 60_000)).map((x) => [x.type, x.value]),
	);
	return {
		y: Number(parts.year),
		mo: Number(parts.month),
		d: Number(parts.day),
		h: Number(parts.hour),
		mi: Number(parts.minute),
		wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? ''),
	};
}

/** Every bound but the last is a local midnight one step after the one before; the last is the end. */
function localCheck(p: ProjectInfo, a: BucketAxis): void {
	const end = frameEndOf(p);
	expect(a.bounds.length).toBe(a.count + 1);
	expect(a.bounds[0]).toBeLessThanOrEqual(0);
	expect(a.bounds[a.count]).toBe(end);
	expect(a.bounds[1]).toBeGreaterThan(0);
	let prev: ReturnType<typeof local> | null = null;
	for (let i = 0; i < a.count; i++) {
		const l = local(p, a.bounds[i] as number);
		expect([l.h, l.mi], `bound ${i}`).toEqual([0, 0]);
		if (a.kind === 'week') expect(l.wd).toBe(p.weekStartsMonday ? 1 : 0);
		if (a.kind === 'month') expect(l.d).toBe(1);
		if (prev) {
			const days = (Date.UTC(l.y, l.mo - 1, l.d) - Date.UTC(prev.y, prev.mo - 1, prev.d)) / 864e5;
			if (a.kind === 'day') expect(days).toBe(1);
			if (a.kind === 'week') expect(days).toBe(7);
			if (a.kind === 'month') expect((l.y - prev.y) * 12 + l.mo - prev.mo).toBe(1);
		}
		prev = l;
	}
}

describe('bucketAxis in UTC', () => {
	const p = project(); // Monday 2026-01-05 to Monday 2026-03-02, UTC

	it('cuts days, weeks and months at midnight', () => {
		const day = bucketAxis(p, zones, 'day');
		expect(day.count).toBe(56);
		expect(lengths(day).every((n) => n === D)).toBe(true);
		const week = bucketAxis(p, zones, 'week');
		expect([...week.bounds]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((w) => w * 7 * D));
		const month = bucketAxis(p, zones, 'month');
		// January from the 1st (4 days before the start), February, then March 1 to the end.
		expect([...month.bounds]).toEqual([-4 * D, 27 * D, 55 * D, 56 * D]);
		for (const a of [day, week, month]) localCheck(p, a);
	});

	it('starts weeks on Sunday when weekstartsmonday is off', () => {
		const a = bucketAxis({ ...p, weekStartsMonday: false }, zones, 'week');
		expect(a.bounds[0]).toBe(-D);
		expect(a.bounds[1]).toBe(6 * D);
		expect(a.bounds[a.count]).toBe(56 * D);
		localCheck({ ...p, weekStartsMonday: false }, a);
	});

	it('puts a Sunday start in the week of the Monday before', () => {
		const sun = { ...p, start: '2026-01-04T00:00:00Z', end: '2026-01-19T00:00:00Z' };
		const a = bucketAxis(sun, zones, 'week');
		expect([...a.bounds]).toEqual([-6 * D, D, 8 * D, 15 * D]);
		const s = bucketAxis({ ...sun, weekStartsMonday: false }, zones, 'week');
		expect([...s.bounds]).toEqual([0, 7 * D, 14 * D, 15 * D]);
	});

	it('finds the bucket of a minute, and -1 outside the frame', () => {
		const a = bucketAxis(p, zones, 'week');
		expect(a.indexOf(-1)).toBe(-1);
		expect(a.indexOf(0)).toBe(0);
		expect(a.indexOf(7 * D - 1)).toBe(0);
		expect(a.indexOf(7 * D)).toBe(1);
		expect(a.indexOf(56 * D - 1)).toBe(7);
		expect(a.indexOf(56 * D)).toBe(-1);
		const m = bucketAxis(p, zones, 'month');
		expect(m.indexOf(0)).toBe(0); // January, although the bucket starts before the frame
		expect(m.indexOf(-1)).toBe(-1);
	});

	it('has no buckets for an empty frame', () => {
		const a = bucketAxis({ ...p, end: p.start }, zones, 'day');
		expect(a.count).toBe(0);
		expect(a.indexOf(0)).toBe(-1);
	});

	it('reuses the axis of a result with the same frame, zone and week start', () => {
		const a = bucketAxis(p, zones, 'week');
		expect(bucketAxis({ ...p, workingTime: [], now: p.end }, zones, 'week')).toBe(a);
		expect(bucketAxis({ ...p, end: '2026-03-09T00:00:00Z' }, zones, 'week').count).toBe(9);
		expect(bucketAxis({ ...p, weekStartsMonday: false }, zones, 'week')).not.toBe(a);
		expect(bucketAxis({ ...p, timezone: 'Europe/Berlin' }, zones, 'week').bounds[0]).toBe(-H);
		expect(bucketAxis(p, zones, 'day')).not.toBe(a);
	});
});

describe('bucketAxis across clock changes', () => {
	it('gives Berlin DST weeks of 167 and 169 hours and days of 23 and 25 (syn-09)', () => {
		const p = goldenProject('syn-09-tz-dst-berlin');
		const week = bucketAxis(p, zones, 'week');
		// 2026-03-02T00:00Z is 01:00 CET, so the first week starts an hour before the frame.
		expect(week.bounds[0]).toBe(-H);
		const hours = lengths(week).map((n) => n / H);
		expect(hours.filter((h) => h === 167)).toHaveLength(1);
		expect(hours.filter((h) => h === 169)).toHaveLength(1);
		// Mon 2026-03-23 is the fourth week; Mon 2026-10-19 the 34th.
		expect(hours[3]).toBe(167);
		expect(hours[33]).toBe(169);
		const day = bucketAxis(p, zones, 'day');
		// The frame ends at 01:00 CET on 2026-11-06, so the last day has one hour.
		expect(lengths(day).filter((n) => n !== D)).toEqual([23 * H, 25 * H, H]);
		for (const kind of ['day', 'week', 'month'] as BucketKind[]) {
			localCheck(p, bucketAxis(p, zones, kind));
		}
	});

	it("handles New York's gap and overlap from a frame that starts on Saturday evening (syn-21)", () => {
		const p = goldenProject('syn-21-tz-dst-edges-newyork');
		const day = bucketAxis(p, zones, 'day');
		// 2025-10-26T00:00Z is Saturday 20:00 EDT: the first day started 20 hours before.
		expect(day.bounds[0]).toBe(-20 * H);
		// Sunday 2025-11-02 (day 8) has 25 hours, Sunday 2026-03-08 (day 134) has 23, and the frame
		// ends at 20:00 EDT on 2026-03-21.
		const len = lengths(day);
		expect(len.flatMap((n, i) => (n === D ? [] : [[i, n / H]]))).toEqual([
			[8, 25],
			[134, 23],
			[147, 20],
		]);
		const week = bucketAxis(p, zones, 'week');
		expect(week.bounds[0]).toBe(-(5 * D + 20 * H));
		for (const kind of ['day', 'week', 'month'] as BucketKind[]) {
			localCheck(p, bucketAxis(p, zones, kind));
		}
	});

	it('cuts Kathmandu days at local midnight, 18:15 UTC (syn-10)', () => {
		const p = goldenProject('syn-10-tz-fractional-offset');
		const day = bucketAxis(p, zones, 'day');
		expect(day.bounds[0]).toBe(-(5 * H + 45));
		expect(
			lengths(day)
				.slice(0, -1)
				.every((n) => n === D),
		).toBe(true);
		localCheck(p, day);
		localCheck(p, bucketAxis(p, zones, 'week'));
	});

	it('follows southern-hemisphere DST in Sydney (syn-11)', () => {
		const p = goldenProject('syn-11-tz-southern-sydney');
		const day = bucketAxis(p, zones, 'day');
		expect(day.bounds[0]).toBe(-10 * H);
		// DST starts on Sunday 2026-10-04 and ends on Sunday 2027-04-04.
		// The frame ends at 10:00 AEST on 2027-05-28.
		expect(lengths(day).filter((n) => n !== D)).toEqual([23 * H, 25 * H, 10 * H]);
		for (const kind of ['day', 'week', 'month'] as BucketKind[]) {
			localCheck(p, bucketAxis(p, zones, kind));
		}
	});

	it('starts each month at local midnight on the 1st (Berlin)', () => {
		const p = goldenProject('syn-09-tz-dst-berlin');
		const month = bucketAxis(p, zones, 'month');
		// March from 2026-03-01 00:00 CET, so 1 day and 1 hour before the frame; April from
		// 2026-04-01 00:00 CEST, 2026-03-31T22:00Z.
		expect(month.bounds[0]).toBe(-(D + H));
		expect(month.bounds[1]).toBe(29 * D + 22 * H);
	});

	it('asks the zone host about once per 7 days, on the plain host and through the Gantt memo', () => {
		const p = goldenProject('fedora-res'); // 611 days in New York, four clock changes
		const counted = (): { host: ZoneOffsets; calls: () => number } => {
			let n = 0;
			const host: ZoneOffsets = {
				offset: (z, e) => (n++, zones.offset(z, e)),
				valid: (z) => zones.valid(z),
			};
			return { host, calls: () => n };
		};
		const plain = counted();
		const day = bucketAxis(p, plain.host, 'day');
		expect(day.count).toBe(611);
		localCheck(p, day);
		// 88 blocks, a few days asked one by one in the weeks of the four changes.
		expect(plain.calls()).toBeLessThan(140);
		// memoZones asks the host three times on a miss; still far fewer than one call per day.
		const memo = counted();
		const viaMemo = bucketAxis(p, memoZones(memo.host), 'day');
		expect(viaMemo.bounds).toEqual(day.bounds);
		expect(memo.calls()).toBeLessThan(3 * 140);
		const week = counted();
		bucketAxis(p, week.host, 'week');
		expect(week.calls()).toBeLessThan(140);
	});
});

describe('gridZones', () => {
	/** A fake zone whose offset flips between 0 and 3600 s at the given UTC days. */
	const flipping = (days: readonly number[]): ZoneOffsets => ({
		offset: (_z, e) => (days.filter((d) => e >= d * 86400).length % 2 === 1 ? 3600 : 0),
		valid: () => true,
	});

	it("gives the host's offset at every UTC midnight when changes are 7 or more days apart", () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({ min: 7, max: 60 }), { maxLength: 12 }),
				fc.integer({ min: 20_000, max: 20_100 }),
				(gaps, first) => {
					const days: number[] = [];
					let d = first;
					for (const g of gaps) days.push((d += g));
					const host = flipping(days);
					const grid = gridZones(host, 'Test/Flip');
					for (let day = first - 10; day < d + 20; day++) {
						expect(grid.offset('Test/Flip', day * 86400)).toBe(
							host.offset('Test/Flip', day * 86400),
						);
					}
					// Other instants and other zones go to the host.
					expect(grid.offset('Test/Flip', first * 86400 + 1)).toBe(
						host.offset('x', first * 86400 + 1),
					);
					expect(grid.offset('Other/Zone', (first + 3) * 86400)).toBe(
						host.offset('Other/Zone', (first + 3) * 86400),
					);
				},
			),
		);
	});
});

describe('bounds on the slot grid', () => {
	// Kathmandu is UTC+05:45, so local midnight is 18:15 UTC, inside the 18:00-19:00 slot of a
	// 60-minute resolution (TaskJuggler refuses that resolution there today, but the rule is the
	// same wherever an offset is off the grid, as Lord Howe's +10:30 winter is at 60 minutes).
	const p = project({ timezone: 'Asia/Kathmandu', timingResolutionMin: 60 });

	it('snaps each bound down to its slot, as dateToIdx truncates', () => {
		const day = bucketAxis(p, zones, 'day');
		expect([...day.bounds.slice(0, 4)]).toEqual([-6 * H, 18 * H, 42 * H, 66 * H]);
		expect([...day.bounds].every((b) => b % 60 === 0)).toBe(true);
		// The whole slot that holds midnight goes to the day that starts there, not 15 and 45 min.
		const slot = bucketSums([[18 * H, 19 * H]], day.bounds);
		expect([slot[0], slot[1]]).toEqual([0, 60]);
		const week = bucketAxis(p, zones, 'week');
		expect(week.bounds[1]).toBe(6 * D + 18 * H);
	});

	it('starts with the bucket that holds minute 0 when a snap moves it there', () => {
		// 18:00 UTC is 23:45 local, but its slot holds the next midnight, so it is the next day's.
		const late = { ...p, start: '2026-01-04T18:00:00Z', end: '2026-01-11T18:00:00Z' };
		const day = bucketAxis(late, zones, 'day');
		expect([...day.bounds.slice(0, 3)]).toEqual([0, D, 2 * D]);
		expect(day.count).toBe(7);
	});
});

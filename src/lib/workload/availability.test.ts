// SPDX-License-Identifier: GPL-2.0-or-later
// Availability (phase-3.md 6.2, 6.3 rule 2; ADR-0014 and its 2026-11-16 amendment): working time
// with `null` read as the project's, part-time hours, leaves, merged bookings and free time;
// groups and other scenarios left out; the slots under overlapping global leaves, and the working
// time filled in there for the hatch, on the T7 fixture and on hand-made frames.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProjectInfo, ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { ROOT } from '../../../tests/grammar/corpus';
import { at, plan, weekdays, DAY, H } from '../schedule/testing';
import type { ZoneOffsets } from '../tjp/values/civil';
import { allLeave, availabilityOf, globalLeaveOverlaps, overlapLeaveOf } from './availability';
import { intersect, subtract } from './intervals';
import { booking, resourceResult, withPeople } from './testing';
import type { PersonAvailability } from './types';

const zones = createTimeZoneHost();

function golden(id: string): ScheduleResult {
	return (
		JSON.parse(
			fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${id}.json`), 'utf8'),
		) as { result: ScheduleResult }
	).result;
}

/** Mon-Fri 09:00-13:00: a part-timer. */
const mornings = weekdays(56, 9, 13);

function sample(): ScheduleResult {
	const base = plan([
		['a', { start: at(0, 9), end: at(1, 12) }],
		['b', { start: at(1, 12), end: at(1, 17) }],
	]);
	return withPeople(
		base,
		[
			resourceResult('team', { group: true }),
			resourceResult('dev1', { parent: 'team', efficiency: 0.8, scenarios: ['late'] }),
			resourceResult('dev2', {
				parent: 'team',
				workingTime: subtract(mornings, [[at(2, 9), at(2, 13)]]) as Array<[number, number]>,
				leaves: [{ type: 'annual', intervals: [[at(2, 9), at(2, 13)]] }],
			}),
		],
		[
			booking('dev1', 'a', [
				[at(0, 9), at(0, 17)],
				[at(1, 9), at(1, 12)],
			]),
			booking('dev1', 'b', [[at(1, 12), at(1, 17)]]),
			booking('dev1', 'a', [[at(3, 9), at(3, 17)]], 'late'),
			booking('dev2', 'b', [[at(3, 9), at(3, 11)]]),
		],
	);
}

describe('availabilityOf', () => {
	it('reads a null workingTime as the project list itself, not a copy', () => {
		const r = sample();
		const a = availabilityOf(r, 'plan');
		expect(a.revision).toBe(r.revision);
		expect(a.scenario).toBe('plan');
		expect(a.people.get('dev1')?.working).toBe(r.project?.workingTime);
	});

	it('keeps part-time hours and leaves as the engine sent them', () => {
		const dev2 = availabilityOf(sample(), 'plan').people.get('dev2') as PersonAvailability;
		expect(dev2.working[0]).toEqual([at(0, 9), at(0, 13)]);
		expect(dev2.working).not.toContainEqual([at(2, 9), at(2, 13)]);
		expect(dev2.leave).toEqual([{ type: 'annual', intervals: [[at(2, 9), at(2, 13)]] }]);
		expect(dev2.efficiency).toBe(1);
	});

	it('merges the bookings of every task, keeps them per task, and frees the rest', () => {
		const dev1 = availabilityOf(sample(), 'plan').people.get('dev1') as PersonAvailability;
		expect(dev1.booked).toEqual([
			[at(0, 9), at(0, 17)],
			[at(1, 9), at(1, 17)],
		]);
		expect(dev1.tasks.map((t) => t.task)).toEqual(['a', 'b']);
		expect(dev1.free[0]).toEqual([at(2, 9), at(2, 17)]);
		expect(subtract(dev1.working, dev1.free)).toEqual(dev1.booked);
		expect(intersect(dev1.free, dev1.booked)).toEqual([]);
		expect(dev1.efficiency).toBe(0.8);
	});

	it('leaves out groups, and reads one scenario', () => {
		const plan = availabilityOf(sample(), 'plan');
		expect([...plan.people.keys()]).toEqual(['dev1', 'dev2']);
		const late = availabilityOf(sample(), 'late');
		expect([...late.people.keys()]).toEqual(['dev1']);
		expect(late.people.get('dev1')?.booked).toEqual([[at(3, 9), at(3, 17)]]);
		expect(availabilityOf(sample(), 'none').people.size).toBe(0);
	});

	it('gives nothing to work with when parsing failed', () => {
		const r = { ...sample(), project: null };
		expect(availabilityOf(r, 'plan').people.get('dev1')?.working).toEqual([]);
	});
});

describe('globalLeaveOverlaps', () => {
	it('finds the day two global leaves share (T7 fixture)', () => {
		const p = golden('workload-overlapping-global-leaves').project as ProjectInfo;
		// Easter (holiday) 04-03 to 04-07 and Overlap (special) 04-06 to 04-08: Monday 04-06.
		expect(globalLeaveOverlaps(p)).toEqual([[7 * DAY, 8 * DAY]]);
	});

	it('counts two or more leaves, and cuts on TaskJuggler slots', () => {
		const base = plan([]).project as ProjectInfo;
		const leaves = (...iv: Array<[number, number]>): ProjectInfo => ({
			...base,
			leaves: iv.map((interval) => ({ type: 'holiday', name: null, interval })),
		});
		expect(globalLeaveOverlaps(leaves([0, DAY]))).toEqual([]);
		expect(globalLeaveOverlaps(leaves([0, 3 * DAY], [DAY, 2 * DAY], [DAY + 30, 4 * DAY]))).toEqual([
			[DAY, 3 * DAY],
		]);
		// Start 30 minutes into a slot: truncated to the slot. Touching leaves do not overlap.
		expect(globalLeaveOverlaps(leaves([0, DAY], [DAY, 2 * DAY]))).toEqual([]);
		expect(globalLeaveOverlaps(leaves([0, 2 * DAY], [DAY + 30, 2 * DAY]))).toEqual([
			[DAY, 2 * DAY],
		]);
		// Before the frame clamps to its first slot; past the end, to the last slot, which a
		// leave then never covers (`dateToIdx` clamps to size - 1, the loop stops before it).
		const end = 56 * DAY;
		expect(globalLeaveOverlaps(leaves([-DAY, DAY], [-2 * DAY, H]))).toEqual([[0, H]]);
		expect(globalLeaveOverlaps(leaves([end - DAY, end + DAY], [end - DAY, end]))).toEqual([
			[end - DAY, end - H],
		]);
	});
});

describe('overlapLeaveOf', () => {
	it("fills in Ada's Monday under both leaves from the Monday before (T7 fixture)", () => {
		const r = golden('workload-overlapping-global-leaves');
		const p = r.project as ProjectInfo;
		const ada = availabilityOf(r, 'plan').people.get('ada') as PersonAvailability;
		const filled = overlapLeaveOf(p, zones, ada);
		expect(filled).toEqual([[at(7, 9), at(7, 17)]]);
		// In neither list: the engine marked it off hours.
		expect(intersect(filled, ada.working)).toEqual([]);
		expect(intersect(filled, allLeave(ada))).toEqual([]);
	});

	const leaveDays = (base: ProjectInfo, ...days: Array<[number, number]>): ProjectInfo => ({
		...base,
		leaves: days.flatMap(([a, b]) => [
			{ type: 'holiday' as const, name: null, interval: [a * DAY, b * DAY] as [number, number] },
			{ type: 'special' as const, name: null, interval: [a * DAY, b * DAY] as [number, number] },
		]),
	});
	const personOn = (working: Array<[number, number]>, over: Partial<PersonAvailability> = {}) => ({
		working,
		leave: [],
		booked: [],
		free: working,
		efficiency: 1,
		tasks: [],
		...over,
	});

	it("takes a part-timer's own hours", () => {
		const p = leaveDays(plan([]).project as ProjectInfo, [16, 17]);
		const working = subtract(mornings, [[16 * DAY, 17 * DAY]]) as Array<[number, number]>;
		expect(overlapLeaveOf(p, zones, personOn(working))).toEqual([[at(16, 9), at(16, 13)]]);
	});

	it('counts a single holiday on the day it copies as hours', () => {
		const p = leaveDays(plan([]).project as ProjectInfo, [15, 16]);
		const working = subtract(weekdays(56), [
			[8 * DAY, 9 * DAY],
			[15 * DAY, 16 * DAY],
		]) as Array<[number, number]>;
		const person = personOn(working, {
			leave: [{ type: 'holiday', intervals: [[at(8, 9), at(8, 17)]] }],
		});
		expect(overlapLeaveOf(p, zones, person)).toEqual([[at(15, 9), at(15, 17)]]);
	});

	it('looks a week later when the week before is outside the frame or also under two leaves', () => {
		const base = plan([]).project as ProjectInfo;
		const working = subtract(weekdays(56), [
			[2 * DAY, 3 * DAY],
			[9 * DAY, 10 * DAY],
		]) as Array<[number, number]>;
		const p = leaveDays(base, [2, 3], [9, 10]);
		expect(overlapLeaveOf(p, zones, personOn(working))).toEqual([
			[at(2, 9), at(2, 17)],
			[at(9, 9), at(9, 17)],
		]);
	});

	it('keeps the local time across a clock change', () => {
		// A zone one hour ahead of UTC from day 10 on: local 09:00-17:00 is 08:00-16:00 UTC there.
		const change = Date.parse('2026-01-15T00:00:00Z') / 1000;
		const shifting: ZoneOffsets = {
			offset: (_z, e) => (e >= change ? 3600 : 0),
			valid: () => true,
		};
		const p = leaveDays({ ...(plan([]).project as ProjectInfo), timezone: 'Test/Shift' }, [14, 15]);
		const working = [
			...weekdays(10),
			...weekdays(56)
				.slice(8)
				.map(([s, e]): [number, number] => [s - H, e - H]),
		].filter(([s]) => s < 14 * DAY || s >= 15 * DAY);
		expect(overlapLeaveOf(p, shifting, personOn(working))).toEqual([[at(14, 8), at(14, 16)]]);
	});

	it('is empty without overlapping global leaves', () => {
		const r = sample();
		const dev1 = availabilityOf(r, 'plan').people.get('dev1') as PersonAvailability;
		expect(overlapLeaveOf(r.project as ProjectInfo, zones, dev1)).toEqual([]);
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
// A task's people in one window (explain-window.ts): slot classes, stretches, the project
// calendar's causes, and the partition property on generated people (13.1).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BookingResult, ResourceLeaves, ScheduleResult } from '../../engine/protocol';
import { mergePairs } from '../workload/intervals';
import { booking, resourceResult, withPeople } from '../workload/testing';
import { prepOf } from './explain-prep';
import { inlineContext, partitionProblems } from './explain-testing';
import { hadFree, segmentsOf, stretches, windowCauses } from './explain-window';
import { DAY, at, plan, weekdays } from './testing';

const TEXT = `project p "P" 2026-01-05 - 2026-03-02
resource dev "Dev"
resource ann "Ann"
task t "T" {
  effort 1d
  allocate dev, ann
}
task a "A" {
  effort 1d
}
`;
const day = (d: number, from = 9, to = 17): [number, number] => [at(d, from), at(d, to)];
/** The project's working days without these: a person's working time off their leave days. */
const without = (...days: number[]) =>
	weekdays(56).filter(([s]) => !days.includes(Math.floor(s / DAY)));

function ctxOf(
	resources: ReturnType<typeof resourceResult>[],
	bookings: BookingResult[],
	over: Parameters<typeof plan>[1] = {},
) {
	const r: ScheduleResult = withPeople(
		plan(
			[
				['t', { start: null, end: null }],
				['a', { start: 0, end: 0 }],
			],
			over,
		),
		resources,
		bookings,
	);
	return inlineContext(r, TEXT);
}

function causesOf(ctx: ReturnType<typeof ctxOf>, ids: string[], from: number, to: number) {
	const people = ids.map((id) => {
		const person = ctx.availability.people.get(id);
		if (!person) throw new Error(id);
		return { id, person };
	});
	return windowCauses('t', people, from, to, prepOf(ctx));
}

describe('segmentsOf and stretches', () => {
	it('classifies busy, own, free, leave and off slots and tiles the window', () => {
		const ctx = ctxOf(
			[
				resourceResult('dev', {
					workingTime: without(2),
					leaves: [{ type: 'annual', intervals: [day(2)] }],
				}),
			],
			[booking('dev', 'a', [day(0)]), booking('dev', 't', [day(1, 9, 12)])],
		);
		const dev = ctx.availability.people.get('dev');
		if (!dev) throw new Error('dev');
		const segs = segmentsOf(dev, prepOf(ctx).own('dev', 't'), 0, at(3, 0), prepOf(ctx));
		expect(segs.map((s) => [s.from, s.to, s.cls, s.type])).toEqual([
			[0, at(0, 9), 'off', null],
			[...day(0), 'busy', null],
			[at(0, 17), at(1, 9), 'off', null],
			[at(1, 9), at(1, 12), 'free', null],
			[at(1, 12), at(1, 17), 'free', null],
			[at(1, 17), at(2, 9), 'off', null],
			[...day(2), 'leave', 'annual'],
			[at(2, 17), at(3, 0), 'off', null],
		]);
		expect(stretches(segs).map((s) => [s.from, s.to, s.cls])).toEqual([
			[0, at(0, 9), 'off'],
			[...day(0), 'busy'],
			[at(0, 17), at(1, 9), 'off'],
			[at(1, 9), at(1, 17), 'free'],
			[at(1, 17), at(2, 9), 'off'],
			[...day(2), 'leave'],
			[at(2, 17), at(3, 0), 'off'],
		]);
	});

	it('joins busy stretches, and leave stretches of one type, across the off hours between', () => {
		const seg = (
			from: number,
			to: number,
			cls: 'busy' | 'leave' | 'off',
			type: 'annual' | 'sick' | null = null,
		) => ({ from, to, cls, type });
		expect(
			stretches([
				seg(0, 10, 'busy'),
				seg(10, 20, 'off'),
				seg(20, 30, 'busy'),
				seg(30, 40, 'off'),
				seg(40, 50, 'leave', 'annual'),
				seg(50, 60, 'off'),
				seg(60, 70, 'leave', 'sick'),
			]),
		).toEqual([
			seg(0, 30, 'busy'),
			seg(30, 40, 'off'),
			seg(40, 50, 'leave', 'annual'),
			seg(50, 60, 'off'),
			seg(60, 70, 'leave', 'sick'),
		]);
	});

	it('finds free time, and the task’s own bookings count as free', () => {
		const ctx = ctxOf(
			[resourceResult('dev')],
			[booking('dev', 'a', [day(0)]), booking('dev', 't', [day(1)])],
		);
		const dev = ctx.availability.people.get('dev');
		if (!dev) throw new Error('dev');
		const own = prepOf(ctx).own('dev', 't');
		expect(hadFree(dev, own, 0, at(1, 0))).toBe(false);
		expect(hadFree(dev, [], at(1, 9), at(1, 10))).toBe(false);
		expect(hadFree(dev, own, at(1, 9), at(1, 10))).toBe(true);
		expect(hadFree(dev, own, at(2, 9), at(2, 10))).toBe(true);
	});
});

describe('windowCauses', () => {
	it('gives one busy stretch with its tasks and booked minutes, and the project nights', () => {
		const ctx = ctxOf([resourceResult('dev')], [booking('dev', 'a', [day(0), day(1), day(2)])]);
		expect(causesOf(ctx, ['dev'], 0, at(3, 9))).toEqual([
			{ kind: 'off-hours', resource: null, window: [0, at(0, 9)] },
			{
				kind: 'busy',
				resource: 'dev',
				window: [at(0, 9), at(2, 17)],
				on: [{ task: 'a', minutes: 1440 }],
			},
			{ kind: 'off-hours', resource: null, window: [at(2, 17), at(3, 9)] },
		]);
	});

	it('gives a personal leave across a weekend as one cause', () => {
		const leaves: ResourceLeaves[] = [{ type: 'annual', intervals: [day(4), day(7)] }];
		const ctx = ctxOf([resourceResult('ann', { workingTime: without(4, 7), leaves })], []);
		expect(causesOf(ctx, ['ann'], at(4, 9), at(7, 17))).toEqual([
			{ kind: 'leave', resource: 'ann', type: 'annual', window: [at(4, 9), at(7, 17)] },
		]);
	});

	it('gives each person their own causes where they differ, and the project’s once', () => {
		const leaves: ResourceLeaves[] = [{ type: 'annual', intervals: [day(0), day(1)] }];
		const ctx = ctxOf(
			[resourceResult('dev'), resourceResult('ann', { workingTime: without(0, 1), leaves })],
			[booking('dev', 'a', [day(0), day(1)])],
		);
		expect(causesOf(ctx, ['dev', 'ann'], 0, 2 * DAY)).toEqual([
			{ kind: 'off-hours', resource: null, window: [0, at(0, 9)] },
			{
				kind: 'busy',
				resource: 'dev',
				window: [at(0, 9), at(1, 17)],
				on: [{ task: 'a', minutes: 960 }],
			},
			{ kind: 'leave', resource: 'ann', type: 'annual', window: [at(0, 9), at(1, 17)] },
			{ kind: 'off-hours', resource: null, window: [at(1, 17), 2 * DAY] },
		]);
	});

	it('gives a global holiday everyone has to the project calendar', () => {
		const holiday: ResourceLeaves[] = [{ type: 'holiday', intervals: [day(0)] }];
		const ctx = ctxOf(
			[resourceResult('dev', { leaves: holiday }), resourceResult('ann', { leaves: holiday })],
			[],
			{
				workingTime: weekdays(56).slice(1),
				leaves: [{ type: 'holiday', name: null, interval: [0, DAY] }],
			},
		);
		expect(causesOf(ctx, ['dev', 'ann'], 0, at(1, 9))).toEqual([
			{ kind: 'off-hours', resource: null, window: [0, at(0, 9)] },
			{ kind: 'leave', resource: null, type: 'holiday', window: day(0) },
			{ kind: 'off-hours', resource: null, window: [at(0, 17), at(1, 9)] },
		]);
	});

	it('gives a part-timer’s afternoon to the person, not to the project', () => {
		const ctx = ctxOf(
			[resourceResult('dev', { workingTime: weekdays(56, 9, 13) })],
			[booking('dev', 'a', [day(0, 9, 13)])],
		);
		expect(causesOf(ctx, ['dev'], 0, at(1, 9))).toEqual([
			{ kind: 'off-hours', resource: null, window: [0, at(0, 9)] },
			{ kind: 'busy', resource: 'dev', window: day(0, 9, 13), on: [{ task: 'a', minutes: 240 }] },
			{ kind: 'off-hours', resource: 'dev', window: [at(0, 13), at(0, 17)] },
			{ kind: 'off-hours', resource: null, window: [at(0, 17), at(1, 9)] },
		]);
	});

	it('reads slots under two global leaves as the later leave (ADR-0014 amendment)', () => {
		// Holiday Fri 9 to Mon 12 (exclusive), special Mon 12 to Wed 14: Mon 12 is under both.
		const ctx = ctxOf(
			[
				resourceResult('dev', {
					workingTime: weekdays(56).filter(([s]) => s < at(4, 0) || s >= at(9, 0)),
					leaves: [
						{ type: 'special', intervals: [day(8)] },
						{ type: 'holiday', intervals: [day(4)] },
					],
				}),
			],
			[],
			{
				leaves: [
					{ type: 'holiday', name: null, interval: [4 * DAY, 8 * DAY] },
					{ type: 'special', name: null, interval: [7 * DAY, 9 * DAY] },
				],
			},
		);
		expect(causesOf(ctx, ['dev'], at(4, 9), at(8, 17))).toEqual([
			{ kind: 'leave', resource: null, type: 'holiday', window: day(4) },
			{ kind: 'off-hours', resource: null, window: [at(4, 17), 7 * DAY] },
			{ kind: 'leave', resource: null, type: 'special', window: [7 * DAY, at(8, 17)] },
		]);
	});

	it('is empty for an empty window or nobody', () => {
		const ctx = ctxOf([resourceResult('dev')], []);
		expect(causesOf(ctx, ['dev'], 100, 100)).toEqual([]);
		expect(windowCauses('t', [], 0, 100, prepOf(ctx))).toEqual([]);
	});
});

describe('the partition property on generated people (13.1)', () => {
	const SLOTS = 14 * 24;
	const TYPES = ['annual', 'sick', 'holiday'] as const;
	// One class per hourly slot: 0 off, 1 to 3 booked on task a, b or c, 4 to 6 a leave type.
	const lane = fc.array(fc.integer({ min: 0, max: 6 }), { minLength: SLOTS, maxLength: SLOTS });
	const runsOf = (classes: number[], pick: (c: number) => boolean): Array<[number, number]> =>
		mergePairs(classes.flatMap((c, i) => (pick(c) ? [[i * 60, i * 60 + 60] as const] : []))).map(
			([a, b]) => [a, b],
		);

	it('tiles the window for every person, the project’s causes included, and stays inside it', () => {
		fc.assert(
			fc.property(
				fc.array(lane, { minLength: 1, maxLength: 3 }),
				fc.nat(SLOTS - 1),
				fc.nat(SLOTS),
				(lanes, x, y) => {
					const from = Math.min(x, y) * 60;
					const to = Math.max(x, y) * 60;
					const ids = lanes.map((_, i) => `p${i}`);
					const resources = lanes.map((classes, i) =>
						resourceResult(ids[i] as string, {
							workingTime: runsOf(classes, (c) => c >= 1 && c <= 3),
							leaves: TYPES.map((type, k) => ({
								type,
								intervals: runsOf(classes, (c) => c === 4 + k),
							})).filter((l) => l.intervals.length > 0),
						}),
					);
					const bookings = lanes.flatMap((classes, i) =>
						['a', 'b', 'c'].map((task, k) =>
							booking(
								ids[i] as string,
								task,
								runsOf(classes, (c) => c === 1 + k),
							),
						),
					);
					const ctx = ctxOf(resources, bookings, {
						leaves: [{ type: 'holiday', name: null, interval: [3 * DAY, 4 * DAY] }],
					});
					const causes = causesOf(ctx, ids, from, to);
					expect(partitionProblems(causes, ids, from, to)).toEqual([]);
					// A busy cause counts exactly its person's booked minutes in it.
					for (const c of causes) {
						if (c.kind !== 'busy') continue;
						const booked = runsOf(
							lanes[ids.indexOf(c.resource)] as number[],
							(k) => k >= 1 && k <= 3,
						);
						const inside = booked.reduce(
							(n, [s, e]) => n + Math.max(0, Math.min(e, c.window[1]) - Math.max(s, c.window[0])),
							0,
						);
						expect(c.on.reduce((n, o) => n + o.minutes, 0)).toBe(inside);
					}
				},
			),
			{ numRuns: 200 },
		);
	});
});

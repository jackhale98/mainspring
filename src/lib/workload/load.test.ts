// SPDX-License-Identifier: GPL-2.0-or-later
// The load model (phase-3.md 6.2, 13.1; types.ts contract) on a hand-made result read with the
// rows of an inline plan: rows in pre-order with collapse, booked, available and leave sums,
// group roll-ups, held and unmet minutes from hand-made demand marks (T10's seam), bands, the
// cell's tasks, dimming without a rebuild, and properties (shuffled bookings give the same model;
// buckets sum to the frame; days add up to weeks and months).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import type { DemandMarks } from '../schedule/explain-types';
import { at, plan, weekdays, DAY } from '../schedule/testing';
import { availabilityOf } from './availability';
import { subtract, totalMinutes } from './intervals';
import { buildLoad, rowMembers, withDimmed } from './load';
import { booking, indexOf, resourceResult, withPeople } from './testing';
import { DEFAULT_THRESHOLDS, type BucketKind, type LoadInput, type LoadModel } from './types';

const zones = createTimeZoneHost();
const H = 60;

const TEXT = `project p "P" 2026-01-05 - 2026-03-02 {
}
resource org "Org" {
  resource team "Team" {
    resource dev1 "Dev 1"
    resource dev2 "Dev 2"
  }
  resource dev3 "Dev 3"
}
resource solo "Solo"
task a "A" {
  effort 5d
  allocate dev1
}
task b "B" {
  effort 2d
  allocate dev2
}
task c "C" {
  effort 1d
  allocate dev3
}
`;
const index = indexOf(TEXT);

type Pairs = Array<[number, number]>;
const mornings = weekdays(56, 9, 13);
const soloLeave: Pairs = [
	[at(9, 9), at(9, 17)],
	...[14, 15, 16, 17, 18].map((d): [number, number] => [at(d, 9), at(d, 17)]),
];

function result(): ScheduleResult {
	const base = plan([
		['a', { start: at(0, 9), end: at(4, 17) }],
		['b', { start: at(7, 9), end: at(8, 13) }],
		['c', { start: at(0, 9), end: at(7, 12) }],
		['ghost', { start: at(21, 9), end: at(21, 10) }],
	]);
	return withPeople(
		base,
		[
			resourceResult('org', { group: true }),
			resourceResult('team', { group: true, parent: 'org' }),
			resourceResult('dev1', { parent: 'team' }),
			resourceResult('dev2', { parent: 'team', workingTime: mornings }),
			resourceResult('dev3', { parent: 'org', efficiency: 0.5 }),
			resourceResult('solo', {
				workingTime: subtract(weekdays(56), soloLeave) as Pairs,
				leaves: [{ type: 'annual', intervals: soloLeave }],
			}),
		],
		[
			booking(
				'dev1',
				'a',
				[0, 1, 2, 3, 4].map((d): [number, number] => [at(d, 9), at(d, 17)]),
			),
			booking('dev1', 'c', [[at(7, 9), at(7, 12)]]),
			booking('dev1', 'ghost', [[at(21, 9), at(21, 10)]]),
			booking('dev2', 'b', [
				[at(7, 9), at(7, 13)],
				[at(8, 9), at(8, 13)],
			]),
			booking('dev3', 'c', [[at(0, 9), at(0, 17)]]),
		],
	);
}

const DEMAND: DemandMarks = {
	held: new Map([
		[
			'dev3',
			[
				{ task: 'b', window: [at(7, 0), at(9, 0)] },
				{ task: 'b', window: [at(14, 9), at(14, 12)] },
			],
		],
		['solo', [{ task: 'a', window: [at(14, 0), at(19, 0)] }]],
	]),
	unmet: new Map([['dev2', [{ task: 'c', window: [at(7, 12), at(7, 14)] }]]]),
};

function build(over: Partial<LoadInput> = {}): LoadModel {
	const r = over.result ?? result();
	return buildLoad({
		result: r,
		index,
		zones,
		kind: 'week',
		collapsed: new Set(),
		availability: availabilityOf(r, 'plan'),
		demand: DEMAND,
		...over,
	});
}

const row = (m: LoadModel, id: string): number => m.rows.findIndex((r) => r.id === id);
const hours = (a: Int32Array | undefined): number[] => [...(a ?? [])].map((v) => v / H);

describe('buildLoad rows', () => {
	it('lists the index resources in pre-order, with depth and group state', () => {
		const m = build();
		expect(m.rows.map((r) => [r.id, r.name, r.depth, r.group, r.expanded, r.textOnly])).toEqual([
			['org', 'Org', 0, true, true, null],
			['team', 'Team', 1, true, true, null],
			['dev1', 'Dev 1', 2, false, null, null],
			['dev2', 'Dev 2', 2, false, null, null],
			['dev3', 'Dev 3', 1, false, null, null],
			['solo', 'Solo', 0, false, null, null],
		]);
		expect(m.revision).toBe(1);
		expect(m.scenario).toBe('plan');
		expect(m.dimmed).toBe(false);
		expect(rowMembers(m, row(m, 'org'))).toEqual(['dev1', 'dev2', 'dev3']);
	});

	it('hides the members of a collapsed group and keeps its sums', () => {
		const open = build();
		const m = build({ collapsed: new Set(['team']) });
		expect(m.rows.map((r) => [r.id, r.expanded])).toEqual([
			['org', true],
			['team', false],
			['dev3', null],
			['solo', null],
		]);
		expect(m.booked[row(m, 'team')]).toEqual(open.booked[row(open, 'team')]);
		const shut = build({ collapsed: new Set(['org']) });
		expect(shut.rows.map((r) => r.id)).toEqual(['org', 'solo']);
		expect(shut.available[0]).toEqual(open.available[0]);
	});

	it('shows a person the text declares and the result does not know yet with zeros', () => {
		const ahead = indexOf(
			TEXT.replace('resource solo "Solo"', 'resource solo "Solo"\nresource newbie "New"'),
		);
		const m = build({ index: ahead });
		const r = row(m, 'newbie');
		expect(r).toBe(6);
		expect(m.available[r]?.every((v) => v === 0)).toBe(true);
		expect(m.band(r, 0, DEFAULT_THRESHOLDS)).toBe('off');
	});
});

describe('buildLoad sums', () => {
	it('sums booked, available and leave per week, groups as their members', () => {
		const m = build();
		expect(m.axis.count).toBe(8);
		expect(hours(m.booked[row(m, 'dev1')]).slice(0, 4)).toEqual([40, 3, 0, 1]);
		expect(hours(m.available[row(m, 'dev2')]).slice(0, 2)).toEqual([20, 20]);
		expect(hours(m.booked[row(m, 'team')]).slice(0, 2)).toEqual([40, 11]);
		expect(hours(m.available[row(m, 'team')]).slice(0, 2)).toEqual([60, 60]);
		expect(hours(m.booked[row(m, 'org')]).slice(0, 2)).toEqual([48, 11]);
		expect(hours(m.available[row(m, 'solo')]).slice(0, 4)).toEqual([40, 32, 0, 40]);
		expect(hours(m.leave[row(m, 'solo')]).slice(0, 4)).toEqual([0, 8, 40, 0]);
		expect(hours(m.leave[row(m, 'org')]).every((v) => v === 0)).toBe(true);
	});

	it('gives held and unmet minutes inside working time, summed over entries', () => {
		const m = build();
		// dev3 waits for b on days 7 and 8 (all day: 16 working hours) and 3 hours on day 14.
		expect(hours(m.held[row(m, 'dev3')]).slice(0, 3)).toEqual([0, 16, 3]);
		// dev2's unmet window 12:00-14:00 meets her mornings for one hour.
		expect(hours(m.unmet[row(m, 'dev2')]).slice(0, 2)).toEqual([0, 1]);
		expect(hours(m.held[row(m, 'org')]).slice(0, 3)).toEqual([0, 16, 3]);
		expect(hours(m.unmet[row(m, 'team')]).slice(0, 2)).toEqual([0, 1]);
		// Solo is on leave all of week 2: the window holds no working time.
		expect(hours(m.held[row(m, 'solo')])[2]).toBe(0);
	});

	it('has zeros for held and unmet without demand', () => {
		const m = build({ demand: null });
		for (const a of [...m.held, ...m.unmet]) expect(a.every((v) => v === 0)).toBe(true);
		expect(m.band(row(m, 'dev3'), 1, DEFAULT_THRESHOLDS)).toBe('spare');
	});

	it('has no buckets when parsing failed, and still the rows', () => {
		const r = { ...result(), project: null };
		const m = build({ result: r, availability: availabilityOf(r, 'plan') });
		expect(m.axis.count).toBe(0);
		expect(m.rows).toHaveLength(6);
		expect(m.booked[0]).toHaveLength(0);
		expect(m.band(0, 0, DEFAULT_THRESHOLDS)).toBe('off');
	});

	it('rebuilds an availability of another revision', () => {
		const r = { ...result(), revision: 2 };
		const stale = availabilityOf({ ...r, bookings: [], revision: 1 }, 'plan');
		const m = build({ result: r, availability: stale });
		expect(hours(m.booked[row(m, 'dev1')])[0]).toBe(40);
	});
});

describe('buildLoad bands', () => {
	it('bands each cell by the rule', () => {
		const m = build();
		const t = DEFAULT_THRESHOLDS;
		expect(m.band(row(m, 'dev1'), 0, t)).toBe('full'); // 100 %
		expect(m.band(row(m, 'dev2'), 0, t)).toBe('spare');
		expect(m.band(row(m, 'dev2'), 1, t)).toBe('over'); // unmet work
		expect(m.band(row(m, 'dev3'), 1, t)).toBe('over'); // held work
		expect(m.band(row(m, 'org'), 1, t)).toBe('over');
		expect(m.band(row(m, 'solo'), 2, t)).toBe('off'); // on leave, although a task waits
		expect(m.band(row(m, 'dev1'), 0, { spareBelow: 80, overAbove: 99 })).toBe('over');
		expect(m.band(99, 0, t)).toBe('off');
		expect(m.band(0, 99, t)).toBe('off');
	});
});

describe('cellTasks', () => {
	it('lists booked tasks by minutes, then held, then unmet', () => {
		const m = build();
		expect(m.cellTasks(row(m, 'dev1'), 1)).toEqual([
			{ task: 'c', minutes: 180, kind: 'booked', movable: true },
		]);
		expect(m.cellTasks(row(m, 'dev2'), 1)).toEqual([
			{ task: 'b', minutes: 480, kind: 'booked', movable: true },
			{ task: 'c', minutes: 60, kind: 'unmet', movable: false },
		]);
		expect(m.cellTasks(row(m, 'dev3'), 1)).toEqual([
			{ task: 'b', minutes: 960, kind: 'held', movable: false },
		]);
	});

	it("lists a group's member tasks, none movable, one entry per task and kind", () => {
		const m = build();
		expect(m.cellTasks(row(m, 'org'), 1)).toEqual([
			{ task: 'b', minutes: 480, kind: 'booked', movable: false },
			{ task: 'c', minutes: 180, kind: 'booked', movable: false },
			{ task: 'b', minutes: 960, kind: 'held', movable: false },
			{ task: 'c', minutes: 60, kind: 'unmet', movable: false },
		]);
	});

	it('lists the work waiting in an off cell with 0 minutes', () => {
		const m = build();
		expect(m.cellTasks(row(m, 'solo'), 2)).toEqual([
			{ task: 'a', minutes: 0, kind: 'held', movable: false },
		]);
	});

	it('does not let a task the text does not declare drag', () => {
		const m = build();
		expect(m.cellTasks(row(m, 'dev1'), 3)).toEqual([
			{ task: 'ghost', minutes: 60, kind: 'booked', movable: false },
		]);
		expect(m.cellTasks(row(m, 'dev1'), 99)).toEqual([]);
		expect(m.cellTasks(row(m, 'dev1'), 0)).toBe(m.cellTasks(row(m, 'dev1'), 0));
	});
});

describe('withDimmed', () => {
	it('re-wraps the model without recomputing anything', () => {
		const m = build();
		const d = withDimmed(m, true);
		expect(d.dimmed).toBe(true);
		expect(d).not.toBe(m);
		expect(d.axis).toBe(m.axis);
		expect(d.rows).toBe(m.rows);
		d.booked.forEach((a, i) => expect(a).toBe(m.booked[i]));
		d.held.forEach((a, i) => expect(a).toBe(m.held[i]));
		expect(d.cellTasks(2, 0)).toBe(m.cellTasks(2, 0));
		expect(d.band(2, 0, DEFAULT_THRESHOLDS)).toBe(m.band(2, 0, DEFAULT_THRESHOLDS));
		expect(withDimmed(d, true)).toBe(d);
		const back = withDimmed(d, false);
		expect(back.dimmed).toBe(false);
		expect(back.booked[0]).toBe(m.booked[0]);
	});

	it('wraps another implementation of the interface too', () => {
		const m = build();
		const plain: LoadModel = {
			...m,
			dimmed: false,
			band: (r, c, t) => m.band(r, c, t),
			cellTasks: (r, c) => m.cellTasks(r, c),
		};
		const d = withDimmed(plain, true);
		expect(d.dimmed).toBe(true);
		expect(d.booked).toBe(plain.booked);
		expect(d.band(2, 0, DEFAULT_THRESHOLDS)).toBe('full');
	});
});

const KINDS: BucketKind[] = ['day', 'week', 'month'];

describe('load properties', () => {
	it('gives the same model for shuffled bookings', () => {
		const base = result();
		const ref = KINDS.map((kind) => build({ kind }));
		fc.assert(
			fc.property(
				fc.shuffledSubarray(base.bookings, { minLength: base.bookings.length }),
				(bookings) => {
					const r = { ...base, bookings };
					KINDS.forEach((kind, k) => {
						const m = build({ result: r, kind, availability: availabilityOf(r, 'plan') });
						const want = ref[k] as LoadModel;
						expect(m.booked).toEqual(want.booked);
						expect(m.available).toEqual(want.available);
						for (let i = 0; i < m.rows.length; i++) {
							for (let c = 0; c < m.axis.count; c++) {
								expect(m.cellTasks(i, c)).toEqual(want.cellTasks(i, c));
							}
						}
					});
				},
			),
			{ numRuns: 20 },
		);
	});

	it('sums each row over its buckets to the frame totals, at every zoom', () => {
		const r = result();
		const people = availabilityOf(r, 'plan').people;
		for (const kind of KINDS) {
			const m = build({ kind });
			m.rows.forEach((rw, i) => {
				const ids = rowMembers(m, i);
				const total = (f: (id: string) => number) => ids.reduce((n, id) => n + f(id), 0);
				const sum = (a: Int32Array | undefined) => [...(a ?? [])].reduce((n, v) => n + v, 0);
				expect(sum(m.booked[i]), `${rw.id} ${kind}`).toBe(
					total((id) => totalMinutes(people.get(id)?.booked ?? [])),
				);
				expect(sum(m.available[i])).toBe(
					total((id) => totalMinutes(people.get(id)?.working ?? [])),
				);
			});
		}
	});

	it('adds days up to weeks and months', () => {
		const day = build({ kind: 'day' });
		for (const kind of ['week', 'month'] as BucketKind[]) {
			const m = build({ kind });
			for (const series of ['booked', 'available', 'leave', 'held', 'unmet'] as const) {
				m.rows.forEach((_, i) => {
					const days = day[series][i] as Int32Array;
					const want = new Int32Array(m.axis.count);
					day.axis.bounds.slice(0, -1).forEach((b, d) => {
						const c = m.axis.indexOf(Math.max(b, 0));
						want[c] = (want[c] as number) + (days[d] as number);
					});
					expect(m[series][i]).toEqual(want);
				});
			}
		}
		expect(day.axis.count).toBe(56);
		expect(day.axis.bounds[1]).toBe(DAY);
	});
});

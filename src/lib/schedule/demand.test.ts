// SPDX-License-Identifier: GPL-2.0-or-later
// Held and unmet work (demand.ts, phase-3.md 5.4, 6.3 rules 2 and 3) on hand-computed fixtures,
// and fed into the load model (`LoadInput.demand`, T9). Day 0 is Monday 2026-01-05 and the
// working day 09:00-17:00 in every plan here.
import { describe, expect, it } from 'vitest';
import type { BookingResult, ScheduleResult } from '../../engine/protocol';
import { buildLoad } from '../workload/load';
import { booking, resourceResult, withPeople, type ResourceSpec } from '../workload/testing';
import { demandOf } from './demand';
import { goldenContext, inlineContext, zones } from './explain-testing';
import type { DemandMarks } from './explain-types';
import { at, dep, plan, weekdays } from './testing';

const plain = (d: DemandMarks) => ({
	held: Object.fromEntries(d.held),
	unmet: Object.fromEntries(d.unmet),
});

describe('held work (rule 2)', () => {
	it('an effort task waiting for its one person (held-effort, H7 fail)', () => {
		// review may start Mon 00:00 (kick) and starts Thu 09:00: dev is on build Mon to Wed.
		expect(plain(demandOf(goldenContext('workload-held-effort')))).toEqual({
			held: { dev: [{ task: 'review', window: [0, 4860] }] },
			unmet: {},
		});
		expect(plain(demandOf(goldenContext('health-h7-fail')))).toEqual({
			held: { dev: [{ task: 'side', window: [0, 4860] }] },
			unmet: {},
		});
		expect(plain(demandOf(goldenContext('health-h7-pass')))).toEqual({ held: {}, unmet: {} });
	});

	it('priority contention and efficiency (syn-17)', () => {
		expect(plain(demandOf(goldenContext('syn-17-priority-efficiency'))).held).toEqual({
			fox: [
				{ task: 'contend.normal', window: [0, 43740] },
				{ task: 'contend.low', window: [0, 63900] },
			],
			gil: [{ task: 'contend.fast', window: [0, 4980] }],
		});
	});

	it('a part-timer busy on the first part (part-time-hours)', () => {
		expect(plain(demandOf(goldenContext('workload-part-time-hours')))).toEqual({
			held: { part: [{ task: 'part_work.p2', window: [10080, 20700] }] },
			unmet: {},
		});
	});

	it('nobody is held when a candidate is free, or only the project calendar fills the wait', () => {
		for (const id of [
			'workload-alternatives',
			'workload-group-allocation',
			'workload-overtime',
			'workload-overlapping-global-leaves',
			'workload-efficiency',
			'syn-13-calendars-leaves',
		]) {
			expect(plain(demandOf(goldenContext(id))), id).toEqual({ held: {}, unmet: {} });
		}
	});
});

describe('unmet work (rule 3)', () => {
	it('a length task that runs without its person (unmet-length, H8 fail)', () => {
		// watch runs Mon 00:00 to Fri 17:00 and has dev only Thu and Fri: dev is on build Mon to Wed.
		expect(plain(demandOf(goldenContext('workload-unmet-length')))).toEqual({
			held: {},
			unmet: { dev: [{ task: 'watch', window: [540, 3900] }] },
		});
		expect(plain(demandOf(goldenContext('health-h8-fail')))).toEqual({
			held: {},
			unmet: { dev: [{ task: 'side', window: [540, 3900] }] },
		});
		expect(plain(demandOf(goldenContext('health-h8-pass')))).toEqual({ held: {}, unmet: {} });
	});

	const TEXT = `project p "P" 2026-01-05 - 2026-03-02
resource ann "Ann"
resource bo "Bo"
resource qa "QA"
resource team "Team" {
  resource m1 "M1"
  resource m2 "M2"
}
task w "W" {
  length 3d
}
task x "X" {
  effort 1d
}
`;
	const day = (d: number): [number, number] => [at(d, 9), at(d, 17)];
	const ctxOf = (
		allocate: string[][],
		bookings: BookingResult[],
		people: Record<string, ResourceSpec> = {},
	) => {
		const r: ScheduleResult = withPeople(
			plan([
				[
					'w',
					{
						start: 0,
						end: at(2, 17),
						scenarios: { plan: { allocate: allocate.map((candidates) => ({ candidates })) } },
					},
				],
				['x', { start: 0, end: at(2, 17) }],
			]),
			['ann', 'bo', 'qa', 'team', 'm1', 'm2'].map((id) =>
				resourceResult(id, {
					group: id === 'team',
					...(id === 'm1' || id === 'm2' ? { parent: 'team' } : {}),
					...people[id],
				}),
			),
			bookings,
		);
		return inlineContext(r, TEXT);
	};

	it('an item is met while one of its people is on the task (alternatives, groups)', () => {
		// ann is on x Monday, and w has bo, its alternative, then: nothing unmet.
		const alt = ctxOf(
			[['ann', 'bo']],
			[booking('ann', 'x', [day(0)]), booking('bo', 'w', [day(0), day(1), day(2)])],
		);
		expect(plain(demandOf(alt)).unmet).toEqual({});
		// team: m1 is on w, m2 on x: the group item is met.
		const group = ctxOf(
			[['team']],
			[booking('m2', 'x', [day(0)]), booking('m1', 'w', [day(0), day(1), day(2)])],
		);
		expect(plain(demandOf(group)).unmet).toEqual({});
	});

	it('each item counts on its own: qa ran, dev did not', () => {
		const ctx = ctxOf(
			[['ann'], ['qa']],
			[
				booking('ann', 'x', [day(0), day(1)]),
				booking('qa', 'w', [day(0), day(1), day(2)]),
				booking('ann', 'w', [day(2)]),
			],
		);
		expect(plain(demandOf(ctx)).unmet).toEqual({
			ann: [{ task: 'w', window: [at(0, 9), at(1, 17)] }],
		});
	});

	it('joins runs across off hours, never across leave; leave itself is not unmet', () => {
		// ann: on x Monday, on leave Tuesday, on x Wednesday.
		const leaves: Record<string, ResourceSpec> = {
			ann: {
				workingTime: weekdays(56).filter(([s]) => Math.floor(s / 1440) !== 1),
				leaves: [{ type: 'annual', intervals: [day(1)] }],
			},
		};
		const ctx = ctxOf([['ann']], [booking('ann', 'x', [day(0), day(2)])], leaves);
		expect(plain(demandOf(ctx)).unmet).toEqual({
			ann: [
				{ task: 'w', window: day(0) },
				{ task: 'w', window: day(2) },
			],
		});
	});
});

describe('demand in the load model (LoadInput.demand)', () => {
	it('gives the held and unmet minutes per person and week, and makes the cell over', () => {
		for (const [id, kind, person, task] of [
			['workload-held-effort', 'held', 'dev', 'review'],
			['workload-unmet-length', 'unmet', 'dev', 'watch'],
		] as const) {
			const ctx = goldenContext(id);
			const demand = demandOf(ctx);
			const input = {
				result: ctx.result,
				index: ctx.index,
				zones,
				kind: 'week' as const,
				collapsed: new Set<string>(),
				availability: ctx.availability,
			};
			const model = buildLoad({ ...input, demand });
			const row = model.rows.findIndex((r) => r.id === person);
			// Three days of 8 h that dev spent on build while the task waited or ran without dev.
			expect(model[kind][row]?.[0], id).toBe(1440);
			expect(model.band(row, 0, { spareBelow: 80, overAbove: 100 })).toBe('over');
			expect(model.cellTasks(row, 0)).toContainEqual({ task, minutes: 1440, kind, movable: false });
			const without = buildLoad({ ...input, demand: null });
			expect(without[kind][row]?.[0]).toBe(0);
		}
	});
});

describe('ALAP held work', () => {
	it('is held over [end, bound)', () => {
		const text = `project p "P" 2026-01-05 - 2026-03-02
resource dev "Dev"
task q "Q" {
  milestone
}
task a "A" {
  effort 1d
}
task z "Z" {
  scheduling alap
  effort 1d
  precedes q
}
`;
		const r = withPeople(
			plan([
				['q', { start: at(4, 9), end: at(4, 9), milestone: true }],
				['a', { start: at(3, 9), end: at(3, 17) }],
				[
					'z',
					{
						start: at(2, 9),
						end: at(2, 17),
						alap: true,
						precedes: [dep('q', { onEnd: false })],
						scenarios: { plan: { allocate: [{ candidates: ['dev'] }] } },
					},
				],
			]),
			[resourceResult('dev')],
			[booking('dev', 'a', [[at(3, 9), at(3, 17)]]), booking('dev', 'z', [[at(2, 9), at(2, 17)]])],
		);
		expect(plain(demandOf(inlineContext(r, text))).held).toEqual({
			dev: [{ task: 'z', window: [at(2, 17), at(4, 9)] }],
		});
	});
});

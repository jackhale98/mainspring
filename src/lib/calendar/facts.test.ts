// SPDX-License-Identifier: GPL-2.0-or-later
// What each Calendar day shows (facts.ts, phase-3.md 9.5): global holidays and a person's leaves
// with their names from the text, a leave no text item names (text only), working and non-working
// days, a group's leaves, and milestones, on the golden `leave-types` fixture and on inline plans.
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../engine/timezone';
import { plan as resultOf } from '../schedule/testing';
import { planFrom, workloadPlan } from '../workload/rebalance-testing';
import { resourceResult, withPeople } from '../workload/testing';
import { buildGrid } from './grid';
import { prepareFacts, strongest, touchesAny } from './facts';
import { onePerson } from './paint-testing';

const zones = createTimeZoneHost();
const DAY = 1440;

/** The facts of a plan's days, for a scope, from the plan's own result. */
function factsOf(
	p: ReturnType<typeof workloadPlan>,
	scope: Parameters<typeof prepareFacts>[0]['scope'],
) {
	const grid = buildGrid(p.result.project, zones);
	return { grid, of: prepareFacts({ result: p.result, index: p.index, scope, grid }) };
}

/** The day index of `yyyy-mm-dd` in a grid. */
function dayOf(grid: ReturnType<typeof buildGrid>, iso: string): number {
	const [y, m, d] = iso.split('-').map(Number);
	const i = grid.days.findIndex((x) => x.year === y && x.month === m && x.date === d);
	if (i < 0) throw new Error(`no day ${iso}`);
	return i;
}

describe('leave-types fixture', () => {
	const p = workloadPlan('leave-types');

	it('names the global holidays from the text, a vacation as a holiday', () => {
		const { grid, of } = factsOf(p, { kind: 'global' });
		const founders = of(dayOf(grid, '2026-01-12'));
		expect(founders.holidays.map((e) => [e.type, e.name, e.from, e.item !== null])).toEqual([
			['holiday', 'Founders day', 'global', true],
		]);
		expect(founders.leaves).toEqual([]);
		expect(founders.top).toBe('holiday');
		expect(founders.textOnly).toBe(false);
		const closure = of(dayOf(grid, '2026-01-26'));
		expect(closure.holidays.map((e) => e.name)).toEqual(['Company closure']);
		expect(of(dayOf(grid, '2026-01-13')).holidays).toEqual([]);
	});

	it("shows a person's own leave by type, and the global holidays too", () => {
		const { grid, of } = factsOf(p, { kind: 'resource', resource: 'p2' });
		// P2: annual "Holiday" 2026-01-08 - 2026-01-10 (the 8th and 9th).
		const a = of(dayOf(grid, '2026-01-08'));
		expect(a.leaves.map((e) => [e.type, e.name, e.from])).toEqual([['annual', 'Holiday', 'own']]);
		expect(a.top).toBe('annual');
		expect(of(dayOf(grid, '2026-01-10')).leaves).toEqual([]);
		const h = of(dayOf(grid, '2026-01-12'));
		expect(h.holidays.map((e) => e.name)).toEqual(['Founders day']);
		expect(h.leaves).toEqual([]);
	});

	it('takes the strongest type of a day that has several (TaskJuggler precedence)', () => {
		// P3's special leave on the 13th and 14th; the global holiday is on the 12th, so no overlap.
		const { grid, of } = factsOf(p, { kind: 'resource', resource: 'p3' });
		expect(of(dayOf(grid, '2026-01-13')).top).toBe('special');
		expect(strongest(['annual', 'sick', 'holiday', 'special'])).toBe('holiday');
		expect(strongest(['holiday', 'unemployed'])).toBe('unemployed');
		expect(strongest([])).toBeNull();
	});

	it('counts weekends as non-working and a leave day as working time lost', () => {
		const { grid, of } = factsOf(p, { kind: 'global' });
		expect(of(dayOf(grid, '2026-01-10')).working).toBe(false);
		expect(of(dayOf(grid, '2026-01-09')).working).toBe(true);
		// The global holiday is off in the project's working time; it is a leave, not a weekend.
		const f = of(dayOf(grid, '2026-01-12'));
		expect(f.working).toBe(false);
		expect(f.top).toBe('holiday');
		// P2's annual leave is working time lost, so the day is a working day for P2.
		const p2 = factsOf(p, { kind: 'resource', resource: 'p2' });
		expect(p2.of(dayOf(p2.grid, '2026-01-08')).working).toBe(true);
	});
});

describe('a leave no text item names', () => {
	// `annual ${when}` is a macro: the index cannot read it, but the engine has the leave slots.
	const base = onePerson('leaves annual ${when}', 'macro when [2026-01-08 - 2026-01-10]\n');
	const slots: Array<[number, number]> = [
		[3 * DAY + 540, 3 * DAY + 1020],
		[4 * DAY + 540, 4 * DAY + 1020],
	];
	const r = withPeople(
		resultOf([['t', { start: 540, end: 2460 }]]),
		[resourceResult('dev', { leaves: [{ type: 'annual', intervals: slots }] })],
		[],
	);
	const p = planFrom({ 'plan.tjp': base.text('plan.tjp') }, 'plan.tjp', r);

	it('lists the engine leave with its type, no name and no item', () => {
		const { grid, of } = factsOf(p, { kind: 'resource', resource: 'dev' });
		const f = of(dayOf(grid, '2026-01-08'));
		expect(f.leaves).toEqual([{ type: 'annual', name: null, from: 'own', who: null, item: null }]);
		expect(f.textOnly).toBe(true);
		expect(f.working).toBe(true);
		expect(of(dayOf(grid, '2026-01-07')).textOnly).toBe(false);
		expect(of(dayOf(grid, '2026-01-07')).leaves).toEqual([]);
	});

	it('keeps a macro leave of another type on a day a text item also touches (T16 review)', () => {
		// A macro's sick leave over the 8th and 9th, and a text annual leave on the 9th: the engine
		// keeps the stronger (sick) on the 9th, which no text item of that type names.
		const q = onePerson(
			'leaves sick ${lv}\n  leaves annual "Trip2" 2026-01-09',
			'macro lv [2026-01-08 - 2026-01-10]\n',
		);
		const sick: Array<[number, number]> = [
			[3 * DAY + 540, 3 * DAY + 1020],
			[4 * DAY + 540, 4 * DAY + 1020],
		];
		const result = withPeople(
			resultOf([['t', { start: 540, end: 2460 }]]),
			[resourceResult('dev', { leaves: [{ type: 'sick', intervals: sick }] })],
			[],
		);
		const both = planFrom({ 'plan.tjp': q.text('plan.tjp') }, 'plan.tjp', result);
		const { grid, of } = factsOf(both, { kind: 'resource', resource: 'dev' });
		const eighth = of(dayOf(grid, '2026-01-08'));
		expect(eighth.leaves.map((e) => [e.type, e.item !== null])).toEqual([['sick', false]]);
		const ninth = of(dayOf(grid, '2026-01-09'));
		expect(ninth.leaves.map((e) => [e.type, e.name, e.item !== null])).toEqual([
			['annual', 'Trip2', true],
			['sick', null, false],
		]);
		expect(ninth.textOnly).toBe(true);
		expect(ninth.top).toBe('sick');
	});

	it('keeps a person’s macro leave on a day with a global holiday when it is the stronger type', () => {
		// The global holiday is on the 12th; a macro's unemployed leave (stronger) is there too.
		const q = onePerson(
			'leaves unemployed ${lv}',
			'leaves holiday "Founders day" 2026-01-12\nmacro lv [2026-01-12]\n',
		);
		const result = withPeople(
			resultOf([['t', { start: 540, end: 2460 }]], {
				leaves: [{ type: 'holiday', name: null, interval: [7 * DAY, 8 * DAY] }],
			}),
			[
				resourceResult('dev', {
					leaves: [{ type: 'unemployed', intervals: [[7 * DAY + 540, 7 * DAY + 1020]] }],
				}),
			],
			[],
		);
		const p2 = planFrom({ 'plan.tjp': q.text('plan.tjp') }, 'plan.tjp', result);
		const { grid, of } = factsOf(p2, { kind: 'resource', resource: 'dev' });
		const f = of(dayOf(grid, '2026-01-12'));
		expect(f.holidays.map((e) => e.name)).toEqual(['Founders day']);
		expect(f.leaves.map((e) => [e.type, e.item !== null])).toEqual([['unemployed', false]]);
		expect(f.textOnly).toBe(true);
	});

	it('does not add an engine leave where a text item already names the day', () => {
		const q = onePerson('leaves annual "Trip" 2026-01-08 - 2026-01-10');
		const result = withPeople(
			resultOf([['t', { start: 540, end: 2460 }]]),
			[resourceResult('dev', { leaves: [{ type: 'annual', intervals: slots }] })],
			[],
		);
		const named = planFrom({ 'plan.tjp': q.text('plan.tjp') }, 'plan.tjp', result);
		const { grid, of } = factsOf(named, { kind: 'resource', resource: 'dev' });
		const f = of(dayOf(grid, '2026-01-08'));
		expect(f.leaves.map((e) => e.name)).toEqual(['Trip']);
		expect(f.textOnly).toBe(false);
	});

	it('is a global text-only day when the project has a leave the text cannot name', () => {
		const q = planFrom(
			{
				'plan.tjp':
					'project p "P" 2026-01-05 - 2026-03-02 {\n}\nleaves holiday ${when}\nmacro when [2026-01-12]\n',
			},
			'plan.tjp',
			resultOf([['t', { start: 540, end: 2460 }]], {
				leaves: [{ type: 'holiday', name: null, interval: [7 * DAY, 8 * DAY] }],
			}),
		);
		const { grid, of } = factsOf(q, { kind: 'global' });
		const f = of(dayOf(grid, '2026-01-12'));
		expect(f.holidays).toEqual([
			{ type: 'holiday', name: null, from: 'global', who: null, item: null },
		]);
		expect(f.textOnly).toBe(true);
	});
});

describe('groups, milestones and the frame', () => {
	it("lists a parent group's leave as the group's", () => {
		const q = onePerson(
			'',
			'resource team "Team" {\n  leaves special "Offsite" 2026-01-19 - 2026-01-21\n  resource m "M"\n}\n',
		);
		const p = planFrom({ 'plan.tjp': q.text('plan.tjp') }, 'plan.tjp', q.result);
		const { grid, of } = factsOf(p, { kind: 'resource', resource: 'm' });
		const f = of(dayOf(grid, '2026-01-19'));
		expect(f.leaves.map((e) => [e.type, e.name, e.from, e.who])).toEqual([
			['special', 'Offsite', 'group', 'Team'],
		]);
	});

	it('puts a milestone on the day it starts, with its name', () => {
		const q = onePerson('leaves annual 2026-01-08');
		const result = resultOf([
			['t', { start: 540, end: 2460 }],
			['m', { start: 5 * DAY, end: 5 * DAY, milestone: true }],
		]);
		const p = planFrom({ 'plan.tjp': q.text('plan.tjp') }, 'plan.tjp', result);
		const { grid, of } = factsOf(p, { kind: 'global' });
		expect(of(dayOf(grid, '2026-01-10')).milestones).toEqual([{ task: 'm', name: 'm' }]);
		expect(of(dayOf(grid, '2026-01-09')).milestones).toEqual([]);
	});

	it('reads a group as working on the project hours', () => {
		const q = onePerson('', 'resource team "Team" {\n  resource m "M"\n}\n');
		const result = withPeople(
			resultOf([['t', { start: 540, end: 2460 }]]),
			[resourceResult('team', { group: true }), resourceResult('m', { parent: 'team' })],
			[],
		);
		const p = planFrom({ 'plan.tjp': q.text('plan.tjp') }, 'plan.tjp', result);
		const { grid, of } = factsOf(p, { kind: 'resource', resource: 'team' });
		expect(of(dayOf(grid, '2026-01-07')).working).toBe(true);
		expect(of(dayOf(grid, '2026-01-10')).working).toBe(false);
	});

	it('throws for a day outside the grid, so a bad index is never read as empty', () => {
		const p = workloadPlan('leave-types');
		const { of } = factsOf(p, { kind: 'global' });
		expect(() => of(9999)).toThrow(RangeError);
	});
});

describe('touchesAny', () => {
	const pairs: Array<[number, number]> = [
		[10, 20],
		[40, 50],
	];
	it('finds an overlap with a sorted list, and none in the gaps', () => {
		expect(touchesAny(pairs, 0, 10)).toBe(false);
		expect(touchesAny(pairs, 0, 11)).toBe(true);
		expect(touchesAny(pairs, 20, 40)).toBe(false);
		expect(touchesAny(pairs, 49, 60)).toBe(true);
		expect(touchesAny(pairs, 50, 60)).toBe(false);
		expect(touchesAny([], 0, 100)).toBe(false);
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
// The paint planner's leave items (paint-items.ts): a scope's own items with their type, name and
// resolved minutes (a vacation as a named holiday, `+2d` and the one-day form resolved), the top
// scenario only, what a person inherits from the global leaves and their parents, items written
// with a macro left out, and the precedence rule of `coveredBy`.
import { describe, expect, it } from 'vitest';
import { planFrom, workloadPlan } from '../workload/rebalance-testing';
import { coveredBy, inheritedItems, leaveRank, scopeItems, type PaintItem } from './paint-items';
import { day, onePerson } from './paint-testing';

const EPOCH = Date.parse('2026-01-05T00:00:00Z') / 1000;
const brief = (items: readonly PaintItem[]) =>
	items.map((i) => [i.type, i.name, i.from / 1440, i.to / 1440]);

describe('scope items', () => {
	const p = workloadPlan('leave-types');

	it('reads the global leaves, a vacation as a named holiday', () => {
		expect(brief(scopeItems(p.index, { kind: 'global' }, EPOCH))).toEqual([
			['holiday', 'Founders day', 7, 8],
			['holiday', 'Company closure', 21, 22],
		]);
	});

	it("reads a person's own items, and what they inherit", () => {
		expect(brief(scopeItems(p.index, { kind: 'resource', resource: 'p2' }, EPOCH))).toEqual([
			['annual', 'Holiday', 3, 5],
		]);
		expect(scopeItems(p.index, { kind: 'resource', resource: 'nobody' }, EPOCH)).toEqual([]);
		expect(brief(inheritedItems(p.index, 'p2', EPOCH))).toEqual([
			['holiday', 'Founders day', 7, 8],
			['holiday', 'Company closure', 21, 22],
		]);
	});

	it('inherits a parent resource’s own leaves, resolves `+2d`, keeps the top scenario only', () => {
		const q = onePerson(
			'leaves annual 2026-01-08 +2d\n  leaves sick 2026-01-12',
			'resource team "Team" {\n  leaves special 2026-01-19 - 2026-01-21\n  resource m "M"\n}\n',
		);
		expect(brief(scopeItems(q.index, { kind: 'resource', resource: 'dev' }, EPOCH))).toEqual([
			['annual', null, 3, 5],
			['sick', null, 7, 8],
		]);
		expect(brief(inheritedItems(q.index, 'm', EPOCH))).toEqual([['special', null, 14, 16]]);
		const base = onePerson('alt:leaves annual 2026-01-08 +2d\n  leaves sick 2026-01-12');
		const text = base
			.text('plan.tjp')
			.replace('{\n}\n', '{\n  scenario plan "Plan" {\n    scenario alt "Alt"\n  }\n}\n');
		const scen = planFrom({ 'plan.tjp': text }, 'plan.tjp', base.result);
		expect(brief(scopeItems(scen.index, { kind: 'resource', resource: 'dev' }, EPOCH))).toEqual([
			['sick', null, 7, 8],
		]);
	});

	it('leaves out an item written with a macro', () => {
		const q = onePerson('leaves annual ${when}', 'macro when [2026-01-08 - 2026-01-10]\n');
		expect(scopeItems(q.index, { kind: 'resource', resource: 'dev' }, EPOCH)).toEqual([]);
	});
});

describe('coveredBy (TaskJuggler precedence)', () => {
	const item = (type: PaintItem['type'], from: number, to: number) =>
		({ type, name: null, from: day(from), to: day(to) }) as PaintItem;

	it('ranks project < annual < special < sick < unpaid < holiday < unemployed', () => {
		const order = [
			'project',
			'annual',
			'special',
			'sick',
			'unpaid',
			'holiday',
			'unemployed',
		] as const;
		expect(order.map(leaveRank)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});

	it('covers with the same or a stronger type, all of the days, in one item or several', () => {
		const items = [item('annual', 0, 3), item('sick', 3, 5), item('project', 5, 9)];
		expect(coveredBy(items, 'annual', day(1), day(2))?.type).toBe('annual');
		expect(coveredBy(items, 'annual', day(1), day(5))?.type).toBe('sick');
		expect(coveredBy(items, 'special', day(1), day(5))).toBeNull();
		expect(coveredBy(items, 'special', day(3), day(5))?.type).toBe('sick');
		expect(coveredBy(items, 'annual', day(4), day(6))).toBeNull();
		expect(coveredBy(items, 'project', day(4), day(6))?.type).toBe('sick');
		expect(
			coveredBy([item('annual', 0, 2), item('annual', 3, 5)], 'annual', day(1), day(4)),
		).toBeNull();
		expect(coveredBy([], 'annual', day(1), day(2))).toBeNull();
	});
});

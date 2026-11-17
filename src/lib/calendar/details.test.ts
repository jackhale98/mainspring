// SPDX-License-Identifier: GPL-2.0-or-later
// What the details of selected days list (details.ts): each leave once however many days it covers,
// own, group and global apart, text-only leaves, milestones, and the working-day count.
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../engine/timezone';
import { workloadPlan } from '../workload/rebalance-testing';
import { detailsOf } from './details';
import { prepareFacts } from './facts';
import { buildGrid } from './grid';

const zones = createTimeZoneHost();

function facts(resource: string | null) {
	const p = workloadPlan('leave-types');
	const grid = buildGrid(p.result.project, zones);
	const of = prepareFacts({
		result: p.result,
		index: p.index,
		scope: resource === null ? { kind: 'global' } : { kind: 'resource', resource },
		grid,
	});
	const day = (iso: string): number =>
		grid.days.findIndex(
			(d) =>
				`${d.year}-${String(d.month).padStart(2, '0')}-${String(d.date).padStart(2, '0')}` === iso,
		);
	return { of, day };
}

describe('detailsOf', () => {
	it('lists a leave once, however many of the selected days it covers', () => {
		const { of, day } = facts('p4');
		// P4's sick "Flu" 2026-01-15 - 2026-01-17 covers the 15th and 16th; select the 14th to the 18th.
		const d = detailsOf(of, day('2026-01-14'), day('2026-01-18'));
		expect(d.days).toBe(5);
		expect(d.own.map((e) => [e.type, e.name])).toEqual([['sick', 'Flu']]);
		expect(d.holidays).toEqual([]);
		expect(d.groups).toEqual([]);
		expect(d.textOnly).toEqual([]);
	});

	it('keeps the global holidays apart from the person’s own', () => {
		const { of, day } = facts('p3');
		const d = detailsOf(of, day('2026-01-12'), day('2026-01-14'));
		expect(d.holidays.map((e) => e.name)).toEqual(['Founders day']);
		expect(d.own.map((e) => e.name)).toEqual(['Study leave']);
	});

	it('counts the working days, a weekend not among them', () => {
		const { of, day } = facts(null);
		// Fri 9, Sat 10, Sun 11, Mon 12 (the global holiday): one working day.
		const d = detailsOf(of, day('2026-01-09'), day('2026-01-12'));
		expect(d.days).toBe(4);
		expect(d.working).toBe(1);
		expect(d.holidays.map((e) => e.name)).toEqual(['Founders day']);
	});

	it('is one day for one day', () => {
		const { of, day } = facts('p2');
		const d = detailsOf(of, day('2026-01-08'), day('2026-01-08'));
		expect([d.lo, d.hi, d.days]).toEqual([day('2026-01-08'), day('2026-01-08'), 1]);
		expect(d.own).toHaveLength(1);
	});

	it('lists nothing on a plain day', () => {
		const { of, day } = facts('p2');
		const d = detailsOf(of, day('2026-02-03'), day('2026-02-03'));
		expect(
			[d.own, d.holidays, d.groups, d.textOnly, d.milestones].every((l) => l.length === 0),
		).toBe(true);
		expect(d.working).toBe(1);
	});
});

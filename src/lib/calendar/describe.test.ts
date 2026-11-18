// SPDX-License-Identifier: GPL-2.0-or-later
// The Calendar's words (describe.ts): month titles, weekday names, a day's accessible name listing
// everything on it, and a range of days. Run in the `en-US` locale so the names are fixed.
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../engine/timezone';
import { workloadPlan } from '../workload/rebalance-testing';
import {
	dateLabel,
	dayChips,
	dayExtra,
	leavePhrase,
	monthTitle,
	monthTitleShort,
	rangeLabel,
	typeName,
	weekdayName,
} from './describe';
import { prepareFacts } from './facts';
import { buildGrid } from './grid';

const zones = createTimeZoneHost();
const L = 'en-US';

describe('names', () => {
	it('titles a month and names the weekdays', () => {
		expect(monthTitle(2026, 11, L)).toBe('November 2026');
		expect(monthTitleShort(2026, 11, L)).toBe('Nov 2026');
		expect(weekdayName(1, false, L)).toBe('Mon');
		expect(weekdayName(0, true, L)).toBe('Sunday');
	});

	it('writes a date with its weekday, from the civil date and not the zone', () => {
		expect(dateLabel({ year: 2026, month: 11, date: 26 }, L)).toBe('Thu, Nov 26, 2026');
	});

	it('names a leave by its type, and a holiday by its name', () => {
		expect(typeName('sick')).toBe('Sick leave');
		expect(leavePhrase({ type: 'annual', name: null })).toBe('Annual leave');
		expect(leavePhrase({ type: 'annual', name: 'Trip' })).toBe('Annual leave: Trip');
		expect(leavePhrase({ type: 'holiday', name: 'Founders day' })).toBe('Holiday: Founders day');
		expect(leavePhrase({ type: 'holiday', name: null })).toBe('Holiday');
	});
});

describe('a day’s chips and extra text', () => {
	const p = workloadPlan('leave-types');
	const grid = buildGrid(p.result.project, zones);
	const day = (iso: string): number =>
		grid.days.findIndex(
			(d) =>
				`${d.year}-${String(d.month).padStart(2, '0')}-${String(d.date).padStart(2, '0')}` === iso,
		);
	const factsOf = (resource: string | null) =>
		prepareFacts({
			result: p.result,
			index: p.index,
			scope: resource === null ? { kind: 'global' } : { kind: 'resource', resource },
			grid,
		});
	const extra = (resource: string | null, iso: string): string => {
		const i = day(iso);
		return dayExtra(grid.days[i]!, factsOf(resource)(i), L);
	};
	const chips = (resource: string | null, iso: string) => dayChips(factsOf(resource)(day(iso)));

	it('lists the holiday and the person’s leave, in the order the cell shows them', () => {
		expect(chips('p2', '2026-01-08')).toEqual([
			{ kind: 'leave', text: 'Annual leave: Holiday', textOnly: false },
		]);
		expect(chips('p2', '2026-01-12')).toEqual([
			{ kind: 'holiday', text: 'Founders day', textOnly: false },
		]);
		expect(chips('p2', '2026-01-13')).toEqual([]);
	});

	it('gives the date after the chips, and says a weekend is a non-working day', () => {
		expect(extra('p2', '2026-01-08')).toBe('Thu, Jan 8, 2026');
		expect(extra(null, '2026-01-10')).toBe('Sat, Jan 10, 2026, Non-working day');
		expect(extra(null, '2026-01-13')).toBe('Tue, Jan 13, 2026');
		// A holiday: its chip shows the name, the text adds that it is a holiday.
		expect(extra('p2', '2026-01-12')).toBe('Mon, Jan 12, 2026, Holiday');
	});

	it('names the chips beyond the ones the cell shows (a taller cell shows more)', () => {
		const i = day('2026-01-12');
		const f = factsOf('p2')(i);
		const d = grid.days[i]!;
		const names = dayChips(f).map((c) => c.text);
		expect(names).toEqual(['Founders day']);
		// One chip, shown: nothing more to say. Shown none (a cell with no room): it is named.
		expect(dayExtra(d, f, L, 1)).toBe('Mon, Jan 12, 2026, Holiday');
		expect(dayExtra(d, f, L, 0)).toBe('Mon, Jan 12, 2026, Holiday, Founders day');
	});

	it('writes a range of days, or one', () => {
		expect(rangeLabel(grid, day('2026-01-08'), day('2026-01-09'), L)).toBe(
			'Thu, Jan 8, 2026 to Fri, Jan 9, 2026',
		);
		expect(rangeLabel(grid, day('2026-01-08'), day('2026-01-08'), L)).toBe('Thu, Jan 8, 2026');
		expect(rangeLabel(grid, -1, 2, L)).toBe('');
	});
});

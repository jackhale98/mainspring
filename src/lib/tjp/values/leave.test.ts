// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { int } from './number';
import {
	leaveFromSpec,
	parseLeaves,
	parseVacation,
	printLeave,
	printLeaves,
	printVacation,
	sameLeave,
	type Leave,
} from './leave';

const leaves = (text: string): Leave[] => {
	const r = parseLeaves(text);
	if (!r.ok) throw new Error(`${text}: ${r.error.code}`);
	return r.value;
};

describe('parseLeaves', () => {
	it('reads type, optional name and interval or date', () => {
		const [l] = leaves('holiday "Thanksgiving" 2026-11-26 +2d');
		expect(l).toMatchObject({ type: 'holiday', name: 'Thanksgiving' });
		expect(l?.interval.end).toEqual({ kind: 'duration', duration: { amount: int(2), unit: 'd' } });
		expect(leaves('annual 2026-01-19 - 2026-01-23')[0]).toMatchObject({
			type: 'annual',
			name: null,
		});
		expect(leaves("sick 'Flu' 2026-02-04")[0]?.interval.end).toBeNull();
	});

	it('reads every leave type and comma-separated lists', () => {
		const all = leaves(
			'project 2026-01-01, annual 2026-01-02, special 2026-01-03, sick 2026-01-04,\n unpaid 2026-01-05, holiday 2026-01-06, unemployed 2026-01-07',
		);
		expect(all.map((l) => l.type)).toEqual([
			'project',
			'annual',
			'special',
			'sick',
			'unpaid',
			'holiday',
			'unemployed',
		]);
	});

	it('gives item, name and interval spans', () => {
		const r = parseLeaves('holiday "x" 2026-11-26 +2d, annual 2026-12-24', 50);
		expect(r).toMatchObject({
			ok: true,
			items: [
				{
					item: { from: 50, to: 76 },
					name: { from: 58, to: 61 },
					interval: { start: { from: 62, to: 72 } },
				},
				{ item: { from: 78, to: 95 }, name: null },
			],
		});
	});

	it('reports precise errors', () => {
		expect(parseLeaves('vacation 2026-01-01')).toMatchObject({
			ok: false,
			error: { code: 'unexpected-token', from: 0, to: 8 },
		});
		expect(parseLeaves('holiday "x"')).toMatchObject({
			ok: false,
			error: { code: 'unexpected-end' },
		});
		expect(parseLeaves('holiday 2026-01-01,')).toMatchObject({
			ok: false,
			error: { code: 'unexpected-end' },
		});
	});
});

describe('printLeave', () => {
	it('writes canonical text that reads back the same', () => {
		for (const [text, canon] of [
			['holiday   "Founders day"  2026-2-9', 'holiday "Founders day" 2026-02-09'],
			["special 'Study' 2026-03-02-2026-03-04", 'special "Study" 2026-03-02 - 2026-03-04'],
			['annual 2011-12-19 +3w', 'annual 2011-12-19 +3w'],
		] as const) {
			const [l] = leaves(text);
			if (!l) throw new Error(text);
			expect(printLeave(l)).toEqual({ ok: true, value: canon });
			expect(sameLeave(leaves(canon)[0] ?? l, l)).toBe(true);
		}
		expect(printLeaves(leaves('sick 2026-01-01, unpaid 2026-01-02'))).toEqual({
			ok: true,
			value: 'sick 2026-01-01, unpaid 2026-01-02',
		});
	});
});

describe('vacation', () => {
	it('reads an optional name and an interval list', () => {
		expect(parseVacation('"Company closure" 2026-02-23')).toMatchObject({
			ok: true,
			value: { name: 'Company closure', intervals: [{ end: null }] },
		});
		expect(parseVacation('2026-02-23 - 2026-02-25, 2026-03-01')).toMatchObject({
			ok: true,
			value: { name: null },
		});
		expect(parseVacation('"x"')).toMatchObject({ ok: false, error: { code: 'unexpected-end' } });
		expect(parseVacation('"x"', 0, { allowEmpty: true })).toMatchObject({
			ok: true,
			value: { intervals: [] },
		});
	});

	it('prints canonically', () => {
		const r = parseVacation("'Closure' 2026-2-23");
		expect(r.ok && printVacation(r.value)).toEqual({ ok: true, value: '"Closure" 2026-02-23' });
	});
});

describe('leaveFromSpec', () => {
	it('builds leaves from the edit API spec', () => {
		expect(
			leaveFromSpec({ type: 'holiday', name: 'x', start: '2026-11-26', end: '+2d' }),
		).toMatchObject({
			ok: true,
			value: { type: 'holiday', name: 'x', interval: { end: { kind: 'duration' } } },
		});
		expect(leaveFromSpec({ type: 'annual', start: '2026-01-19', end: '2026-01-23' })).toMatchObject(
			{
				ok: true,
				value: { name: null, interval: { end: { kind: 'date' } } },
			},
		);
		expect(leaveFromSpec({ type: 'sick', start: '2026-02-04' })).toMatchObject({
			ok: true,
			value: { interval: { end: null } },
		});
	});

	it('refuses bad parts', () => {
		expect(leaveFromSpec({ type: 'sick', start: '2026-02-30x' }).ok).toBe(false);
		expect(leaveFromSpec({ type: 'sick', start: '2026-02-03', end: '+2 days' }).ok).toBe(false);
		expect(leaveFromSpec({ type: 'sick', name: '${x}', start: '2026-02-03' })).toMatchObject({
			ok: false,
			error: { code: 'unsafe-text' },
		});
	});
});

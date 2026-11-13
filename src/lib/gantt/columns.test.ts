// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { COLUMN_ORDER, COLUMN_REM, MIN_CHART_REM, layoutColumns, widthOf } from './columns';

describe('layoutColumns', () => {
	it('shows only the name on a phone', () => {
		expect(layoutColumns(412, 124, 16)).toEqual({ shown: ['name'], extraRem: 0 });
	});

	it('adds the dates on a portrait tablet, and nothing the chart needs', () => {
		const l = layoutColumns(820, 224, 16);
		expect(l.shown).toEqual(['name', 'start', 'end']);
		expect(l.extraRem).toBe(COLUMN_REM.start + COLUMN_REM.end);
	});

	it('shows every column on a wide desktop, in the order of the cells', () => {
		const l = layoutColumns(1600, 300, 16);
		expect(l.shown).toEqual(COLUMN_ORDER);
	});

	it('always leaves the chart its minimum, whatever the width', () => {
		for (let w = 300; w <= 2400; w += 37) {
			const l = layoutColumns(w, 300, 16);
			if (l.shown.length === 1) continue;
			expect(w - 300 - l.extraRem * 16).toBeGreaterThanOrEqual(MIN_CHART_REM * 16);
		}
	});

	it('shows more columns as the Gantt grows, never fewer', () => {
		let before = 0;
		for (let w = 300; w <= 2400; w += 10) {
			const n = layoutColumns(w, 300, 16).shown.length;
			expect(n).toBeGreaterThanOrEqual(before);
			before = n;
		}
	});

	it('follows the reader’s text size: a larger rem fits fewer columns', () => {
		expect(layoutColumns(1300, 300, 24).shown.length).toBeLessThan(
			layoutColumns(1300, 300, 16).shown.length,
		);
	});

	it('copes with a rem of zero (not laid out yet)', () => {
		expect(layoutColumns(1300, 300, 0).shown).toEqual(['name']);
	});
});

describe('widthOf', () => {
	it('is a token for the name and rem for the rest', () => {
		expect(widthOf('name')).toBeNull();
		expect(widthOf('end')).toBe(COLUMN_REM.end);
	});
});

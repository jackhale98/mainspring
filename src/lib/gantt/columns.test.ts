// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	COLUMN_ORDER,
	COLUMN_REM,
	DEFAULT_COLUMNS,
	extrasRem,
	numberColumnRem,
	FROZEN_COLUMNS,
	shownColumns,
	widthOf,
} from './columns';
import { LEAST_TABLE_REM, leastTableWidth } from './table';

describe('shownColumns', () => {
	it('draws every column in the order of the cells; a narrow pane keeps the number and the name', () => {
		expect(shownColumns('full')).toEqual(COLUMN_ORDER);
		expect(shownColumns('narrow')).toEqual(FROZEN_COLUMNS);
		expect(shownColumns('narrow')).toEqual(['number', 'name']);
	});

	it('draws the name alone on a phone', () => {
		expect(shownColumns('phone')).toEqual(['name']);
	});

	it('puts the row number first, the name second and the links last', () => {
		expect(COLUMN_ORDER.slice(0, 2)).toEqual(['number', 'name']);
		expect(COLUMN_ORDER.slice(-2)).toEqual(['predecessors', 'successors']);
	});
});

describe('extrasRem', () => {
	it('adds the natural widths of the columns but the name', () => {
		expect(extrasRem(['name'])).toBe(0);
		expect(extrasRem(DEFAULT_COLUMNS)).toBe(
			COLUMN_REM.number + COLUMN_REM.start + COLUMN_REM.end + COLUMN_REM.effort,
		);
		expect(extrasRem(COLUMN_ORDER)).toBe(Object.values(COLUMN_REM).reduce((sum, w) => sum + w, 0));
	});
});

describe('the least table width', () => {
	it('keeps the name its 10 rem beside the row number (polish items 13 and 16)', () => {
		const least = leastTableWidth(16);
		expect(least - COLUMN_REM.number * 16).toBeGreaterThanOrEqual(LEAST_TABLE_REM * 16);
		expect(least).toBe((LEAST_TABLE_REM + COLUMN_REM.number) * 16);
	});
});

describe('numberColumnRem', () => {
	it('has room for three digits, and half a rem more for each digit after', () => {
		for (const rows of [1, 9, 99, 500, 999]) expect(numberColumnRem(rows)).toBe(COLUMN_REM.number);
		expect(numberColumnRem(1000)).toBe(COLUMN_REM.number + 0.5);
		expect(numberColumnRem(12_345)).toBe(COLUMN_REM.number + 1);
		expect(numberColumnRem(0)).toBe(COLUMN_REM.number);
	});

	it('is the width widthOf and extrasRem use for the # column when given', () => {
		expect(widthOf('number')).toBe(COLUMN_REM.number);
		expect(widthOf('number', 3)).toBe(3);
		expect(extrasRem(['number', 'name'], 3)).toBe(3);
		expect(extrasRem(['number', 'name'])).toBe(COLUMN_REM.number);
	});
});

describe('widthOf', () => {
	it('is a token for the name and rem for the rest', () => {
		expect(widthOf('name')).toBeNull();
		expect(widthOf('end')).toBe(COLUMN_REM.end);
	});
});

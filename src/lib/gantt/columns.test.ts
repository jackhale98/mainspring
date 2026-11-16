// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	COLUMN_ORDER,
	COLUMN_REM,
	DEFAULT_COLUMNS,
	extrasRem,
	FROZEN_COLUMNS,
	shownColumns,
	widthOf,
} from './columns';
import { LEAST_TABLE_REM } from './table';

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
	it('holds the row number and a name of useful width in 10 rem (polish item 13 and 16)', () => {
		expect(LEAST_TABLE_REM - COLUMN_REM.number).toBeGreaterThanOrEqual(7.5);
	});
});

describe('widthOf', () => {
	it('is a token for the name and rem for the rest', () => {
		expect(widthOf('name')).toBeNull();
		expect(widthOf('end')).toBe(COLUMN_REM.end);
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	COLUMN_ORDER,
	COLUMN_REM,
	DEFAULT_COLUMNS,
	extrasRem,
	shownColumns,
	widthOf,
} from './columns';

describe('shownColumns', () => {
	it('draws every column, in the order of the cells, except on a phone', () => {
		expect(shownColumns(false)).toEqual(COLUMN_ORDER);
		expect(shownColumns(true)).toEqual(['name']);
	});
});

describe('extrasRem', () => {
	it('adds the natural widths of the columns but the name', () => {
		expect(extrasRem(['name'])).toBe(0);
		expect(extrasRem(DEFAULT_COLUMNS)).toBe(COLUMN_REM.start + COLUMN_REM.end + COLUMN_REM.effort);
		expect(extrasRem(COLUMN_ORDER)).toBe(Object.values(COLUMN_REM).reduce((sum, w) => sum + w, 0));
	});
});

describe('widthOf', () => {
	it('is a token for the name and rem for the rest', () => {
		expect(widthOf('name')).toBeNull();
		expect(widthOf('end')).toBe(COLUMN_REM.end);
	});
});

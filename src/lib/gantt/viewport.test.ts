// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { sheetTopOf, visibleChart } from './viewport';

const scroller = { left: 0, top: 100, right: 1000, bottom: 700 };

describe('visibleChart', () => {
	it('is the scroller without the task column and the time header', () => {
		expect(visibleChart(scroller, 300, 64, { sheetTop: null, drawerLeft: null })).toEqual({
			left: 300,
			top: 164,
			right: 1000,
			bottom: 700,
		});
	});

	it('stops at a bottom sheet and at a drawer over the right edge', () => {
		expect(visibleChart(scroller, 300, 64, { sheetTop: 400, drawerLeft: 680 })).toEqual({
			left: 300,
			top: 164,
			right: 680,
			bottom: 400,
		});
	});

	it('is never inside out when a sheet covers nearly everything', () => {
		const b = visibleChart(scroller, 300, 64, { sheetTop: 120, drawerLeft: 200 });
		expect(b.right).toBeGreaterThanOrEqual(b.left);
		expect(b.bottom).toBeGreaterThanOrEqual(b.top);
	});
});

describe('sheetTopOf', () => {
	it('is the viewport height less the sheet, or null for none', () => {
		expect(sheetTopOf(300, 800)).toBe(500);
		expect(sheetTopOf(0, 800)).toBeNull();
	});
});

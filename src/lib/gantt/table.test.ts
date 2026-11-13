// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { MAX_RATIO, MIN_RATIO } from '../state/split';
import { COLUMN_REM, WIDEST_COLUMN_REM } from './columns';
import {
	MIN_CHART_SHARE,
	defaultTableRatio,
	leastTableWidth,
	parseTableRatio,
	serializeTableRatio,
	tableLimits,
	tableWidth,
} from './table';

describe('defaultTableRatio', () => {
	it('is the default columns share of the width while the chart keeps its 40%', () => {
		expect(defaultTableRatio(1440, 500)).toBeCloseTo(500 / 1440);
	});

	it('lets the divider its own half width in, so that the columns are not clipped by it', () => {
		const ratio = defaultTableRatio(1000, 500, 10);
		expect(tableWidth({ ratio, ganttPx: 1000, dividerPx: 10, leastPx: 300 })).toBe(500);
	});

	it('is capped so that the chart keeps 40% where the columns need more', () => {
		expect(defaultTableRatio(820, 600)).toBeCloseTo(1 - MIN_CHART_SHARE);
		expect(defaultTableRatio(300, 600)).toBeCloseTo(1 - MIN_CHART_SHARE);
	});

	it('never leaves the divider its limits, and copes with an unmeasured width', () => {
		expect(defaultTableRatio(10_000, 10)).toBe(MIN_RATIO);
		expect(defaultTableRatio(0, 500)).toBeGreaterThanOrEqual(MIN_RATIO);
		expect(defaultTableRatio(0, 500)).toBeLessThanOrEqual(MAX_RATIO);
	});
});

describe('the least the pane is', () => {
	it('is the name column and the widest other column, so that a focused cell fits beside the name', () => {
		expect(WIDEST_COLUMN_REM).toBe(Math.max(...Object.values(COLUMN_REM)));
		expect(leastTableWidth(300, 16)).toBe(300 + WIDEST_COLUMN_REM * 16);
		expect(leastTableWidth(124, 0)).toBe(124);
	});

	it('is the divider limit the separator reports, within the Split limits', () => {
		const space = { ganttPx: 1000, dividerPx: 10, leastPx: leastTableWidth(300, 16) };
		const limits = tableLimits(space);
		expect(limits.max).toBe(MAX_RATIO);
		expect(limits.min).toBeCloseTo((space.leastPx + 5) / 1000);
		// A wide Gantt keeps the Split divider's own minimum; a narrow one cannot go below its real one.
		expect(tableLimits({ ...space, ganttPx: 10_000 }).min).toBe(MIN_RATIO);
		expect(tableLimits({ ...space, ganttPx: 300 }).min).toBe(MAX_RATIO);
		expect(tableLimits({ ...space, ganttPx: 0 })).toEqual({ min: MIN_RATIO, max: MAX_RATIO });
	});
});

describe('tableWidth', () => {
	const base = { ganttPx: 1000, dividerPx: 10, leastPx: 432 };

	it('ends half a divider before the ratio, whose centre is the divider', () => {
		expect(tableWidth({ ...base, ratio: 0.5 })).toBe(495);
	});

	it('is never narrower than the name column and the widest column', () => {
		for (let r = 0; r <= 1; r += 0.01) {
			expect(tableWidth({ ...base, ratio: r })).toBeGreaterThanOrEqual(432);
		}
		expect(tableWidth({ ...base, ratio: MIN_RATIO })).toBe(432);
	});

	it('leaves the chart a fifth of the width at least, even where the least would not', () => {
		expect(tableWidth({ ...base, ratio: 1 })).toBeLessThanOrEqual(800 - 10);
		expect(tableWidth({ ...base, ratio: 0.95 })).toBe(790);
		expect(tableWidth({ ...base, ganttPx: 400, leastPx: 432, ratio: 0.2 })).toBe(310);
	});

	it('grows with the ratio, never shrinking', () => {
		let last = 0;
		for (let r = 0; r <= 1; r += 0.01) {
			const w = tableWidth({ ...base, ratio: r });
			expect(w).toBeGreaterThanOrEqual(last);
			last = w;
		}
	});

	it('is the least before the Gantt has a width', () => {
		expect(tableWidth({ ...base, ganttPx: 0, ratio: 0.5 })).toBe(432);
	});
});

describe('stored position', () => {
	it('round-trips, and anything malformed means the default', () => {
		expect(parseTableRatio(serializeTableRatio(0.4321))).toBeCloseTo(0.4321);
		expect(parseTableRatio(null)).toBeNull();
		expect(parseTableRatio('wide')).toBeNull();
		expect(parseTableRatio('NaN')).toBeNull();
	});

	it('keeps a stored ratio within the limits', () => {
		expect(parseTableRatio('0.01')).toBe(MIN_RATIO);
		expect(parseTableRatio('7')).toBe(MAX_RATIO);
		expect(serializeTableRatio(2)).toBe(String(MAX_RATIO));
	});
});

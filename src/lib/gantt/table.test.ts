// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { MAX_RATIO, MIN_RATIO } from '../state/split';
import { WIDEST_COLUMN_REM } from './columns';
import {
	LEAST_TABLE_REM,
	MIN_CHART_SHARE,
	TABLE_MIN_RATIO,
	clampTableRatio,
	columnsFit,
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
		expect(defaultTableRatio(100_000, 10)).toBe(TABLE_MIN_RATIO);
		expect(defaultTableRatio(0, 500)).toBeGreaterThanOrEqual(TABLE_MIN_RATIO);
		expect(defaultTableRatio(0, 500)).toBeLessThanOrEqual(MAX_RATIO);
	});
});

describe('the least the pane is', () => {
	it('is the name column at 10 rem plus the # beside it, and follows the text size', () => {
		// The # column does not take from the name's 10 rem (polish items 13 and 16).
		expect(leastTableWidth(16)).toBe(196);
		expect(leastTableWidth(20)).toBe(245);
		expect(LEAST_TABLE_REM).toBe(10);
		// A plan of thousands of tasks has a wider # and so a wider least.
		expect(leastTableWidth(16, 2.75)).toBe(204);
	});

	it('is the divider limit the separator reports, below the Split limits', () => {
		const space = { ganttPx: 1400, dividerPx: 10, leastPx: leastTableWidth(16) };
		const limits = tableLimits(space);
		expect(limits.max).toBe(MAX_RATIO);
		expect(limits.min).toBeCloseTo((196 + 5) / 1400);
		expect(limits.min).toBeLessThan(MIN_RATIO);
		// A very wide Gantt keeps the ratio floor; a narrow one cannot go below its real least.
		expect(tableLimits({ ...space, ganttPx: 100_000 }).min).toBe(TABLE_MIN_RATIO);
		expect(tableLimits({ ...space, ganttPx: 150 }).min).toBe(MAX_RATIO);
		expect(tableLimits({ ...space, ganttPx: 0 })).toEqual({ min: TABLE_MIN_RATIO, max: MAX_RATIO });
	});

	it('shows columns only where the frozen columns and the widest column fit beside each other', () => {
		const need = 300 + WIDEST_COLUMN_REM * 16;
		expect(columnsFit(need, 300, 16)).toBe(true);
		expect(columnsFit(need + 50, 300, 16)).toBe(true);
		expect(columnsFit(need - 20, 300, 16)).toBe(false);
		expect(columnsFit(160, 300, 16)).toBe(false);
	});
});

describe('tableWidth', () => {
	const base = { ganttPx: 1000, dividerPx: 10, leastPx: 160 };

	it('ends half a divider before the ratio, whose centre is the divider', () => {
		expect(tableWidth({ ...base, ratio: 0.5 })).toBe(495);
	});

	it('is never narrower than its least', () => {
		for (let r = 0; r <= 1; r += 0.01) {
			expect(tableWidth({ ...base, ratio: r })).toBeGreaterThanOrEqual(160);
		}
		expect(tableWidth({ ...base, ratio: TABLE_MIN_RATIO })).toBe(160);
		expect(tableWidth({ ...base, ratio: 0.2 })).toBe(195);
	});

	it('leaves the chart a fifth of the width at least, even where the least would not', () => {
		expect(tableWidth({ ...base, ratio: 1 })).toBeLessThanOrEqual(800 - 10);
		expect(tableWidth({ ...base, ratio: 0.95 })).toBe(790);
		expect(tableWidth({ ...base, ganttPx: 400, leastPx: 432, ratio: 0.2 })).toBe(310);
		expect(tableWidth({ ...base, ganttPx: 200, ratio: 0.01 })).toBe(150);
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
		expect(tableWidth({ ...base, ganttPx: 0, ratio: 0.5 })).toBe(160);
	});
});

describe('stored position', () => {
	it('round-trips, and anything malformed means the default', () => {
		expect(parseTableRatio(serializeTableRatio(0.4321))).toBeCloseTo(0.4321);
		expect(parseTableRatio(null)).toBeNull();
		expect(parseTableRatio('wide')).toBeNull();
		expect(parseTableRatio('NaN')).toBeNull();
	});

	it('keeps a stored ratio within the limits, which go below the Split divider fifth', () => {
		expect(parseTableRatio('0.001')).toBe(TABLE_MIN_RATIO);
		expect(parseTableRatio('0.05')).toBe(0.05);
		expect(parseTableRatio('7')).toBe(MAX_RATIO);
		expect(serializeTableRatio(2)).toBe(String(MAX_RATIO));
		expect(clampTableRatio(0.03, { min: 0.1, max: 0.8 })).toBe(0.1);
		expect(clampTableRatio(Number.NaN)).toBeGreaterThanOrEqual(TABLE_MIN_RATIO);
	});
});

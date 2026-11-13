// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RATIOS,
	MAX_RATIO,
	MIN_RATIO,
	clampRatio,
	parseRatios,
	ratioFromPointer,
	serializeRatios,
	stepRatio,
} from './split';

describe('split ratios', () => {
	it('clamps so that neither panel can be dragged shut', () => {
		expect(clampRatio(0)).toBe(MIN_RATIO);
		expect(clampRatio(1)).toBe(MAX_RATIO);
		expect(clampRatio(0.5)).toBe(0.5);
		expect(clampRatio(Number.NaN)).toBe(DEFAULT_RATIOS.col);
	});

	it('turns a pointer position into a ratio of the container', () => {
		expect(ratioFromPointer(500, 100, 1000)).toBeCloseTo(0.4);
		expect(ratioFromPointer(0, 100, 1000)).toBe(MIN_RATIO);
		expect(ratioFromPointer(5000, 100, 1000)).toBe(MAX_RATIO);
		expect(ratioFromPointer(5, 0, 0)).toBe(DEFAULT_RATIOS.col);
	});

	it('steps by key: Left and Right side by side, Up and Down stacked', () => {
		expect(stepRatio(0.4, 'ArrowRight', 'col', false)).toBeCloseTo(0.42);
		expect(stepRatio(0.4, 'ArrowLeft', 'col', true)).toBeCloseTo(0.3);
		expect(stepRatio(0.5, 'ArrowDown', 'row', false)).toBeCloseTo(0.52);
		expect(stepRatio(0.5, 'ArrowUp', 'row', false)).toBeCloseTo(0.48);
		expect(stepRatio(0.4, 'Home', 'col', false)).toBe(MIN_RATIO);
		expect(stepRatio(0.4, 'End', 'col', false)).toBe(MAX_RATIO);
		expect(stepRatio(0.4, 'ArrowUp', 'col', false)).toBeNull();
		expect(stepRatio(0.79, 'ArrowRight', 'col', true)).toBe(MAX_RATIO);
	});

	it('round-trips through storage and repairs what is malformed', () => {
		expect(parseRatios(serializeRatios({ col: 0.33, row: 0.61 }))).toEqual({
			col: 0.33,
			row: 0.61,
		});
		expect(parseRatios(null)).toEqual(DEFAULT_RATIOS);
		expect(parseRatios('not json')).toEqual(DEFAULT_RATIOS);
		expect(parseRatios('{"col":"wide","row":9}')).toEqual({
			col: DEFAULT_RATIOS.col,
			row: MAX_RATIO,
		});
		expect(parseRatios('7')).toEqual(DEFAULT_RATIOS);
	});
});

describe('narrower limits', () => {
	const limits = { min: 0.4, max: 0.7 };

	it('clamp a ratio, a pointer and the keys to them', () => {
		expect(clampRatio(0.1, limits)).toBe(0.4);
		expect(clampRatio(0.9, limits)).toBe(0.7);
		expect(ratioFromPointer(0, 0, 1000, limits)).toBe(0.4);
		expect(ratioFromPointer(990, 0, 1000, limits)).toBe(0.7);
		expect(stepRatio(0.41, 'ArrowLeft', 'col', false, limits)).toBe(0.4);
		expect(stepRatio(0.5, 'Home', 'col', false, limits)).toBe(0.4);
		expect(stepRatio(0.5, 'End', 'col', false, limits)).toBe(0.7);
	});

	it('a minimum above the maximum is the maximum', () => {
		expect(clampRatio(0.3, { min: 0.9, max: 0.8 })).toBe(0.8);
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	clampRatio,
	parseRatio,
	readRatio,
	TABLE_RATIO_DEFAULT,
	TABLE_RATIO_LIMITS,
	tableRatioKey,
	writeRatio,
} from './prefs';

const memory = (): Parameters<typeof readRatio>[0] & { map: Map<string, string> } => {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
	};
};

describe('the table divider’s preference', () => {
	it('keeps the ratio per plan, within the limits', () => {
		const s = memory();
		writeRatio(s, 'upstream-tutorial', 0.333333);
		expect(s.map.get(tableRatioKey('upstream-tutorial'))).toBe('0.333');
		expect(readRatio(s, 'upstream-tutorial')).toBe(0.333);
		expect(readRatio(s, 'other')).toBe(TABLE_RATIO_DEFAULT);
		writeRatio(s, 'a', 0.99);
		expect(readRatio(s, 'a')).toBe(TABLE_RATIO_LIMITS.max);
	});

	it('falls back to the default for anything that is not a number', () => {
		for (const raw of [null, '', '  ', 'wide', 'NaN', '{}'])
			expect(parseRatio(raw)).toBe(TABLE_RATIO_DEFAULT);
		expect(parseRatio('0.01')).toBe(TABLE_RATIO_LIMITS.min);
		expect(clampRatio(Infinity)).toBe(TABLE_RATIO_DEFAULT);
	});

	it('works without storage', () => {
		expect(readRatio(null, 'x')).toBe(TABLE_RATIO_DEFAULT);
		expect(() => writeRatio(null, 'x', 0.4)).not.toThrow();
	});
});

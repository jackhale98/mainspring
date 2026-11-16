// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { PrefStorage } from '../state/storage';
import {
	DEFAULT_HEAT_PREFS,
	heatKey,
	parseHeatPrefs,
	readHeatPrefs,
	validThresholds,
	writeHeatPrefs,
} from './heat-prefs';

function memory(): PrefStorage & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}
const blocked: PrefStorage = {
	getItem() {
		throw new Error('blocked');
	},
	setItem() {
		throw new Error('blocked');
	},
};

describe('heatmap preferences', () => {
	it('defaults to week zoom, hours, 80 and 100, nothing collapsed', () => {
		expect(DEFAULT_HEAT_PREFS).toEqual({
			zoom: 'week',
			unit: 'hours',
			thresholds: { spareBelow: 80, overAbove: 100 },
			collapsed: [],
		});
		expect(readHeatPrefs(memory(), 'fedora-res')).toEqual(DEFAULT_HEAT_PREFS);
	});

	it('stores per plan and reads back', () => {
		const s = memory();
		const p = {
			zoom: 'month' as const,
			unit: 'percent' as const,
			thresholds: { spareBelow: 60, overAbove: 90 },
			collapsed: ['team.a'],
		};
		writeHeatPrefs(s, 'one', p);
		expect(readHeatPrefs(s, 'one')).toEqual(p);
		expect(readHeatPrefs(s, 'two')).toEqual(DEFAULT_HEAT_PREFS);
		expect(s.map.has(heatKey('one'))).toBe(true);
	});

	it('takes each field on its own and defaults the rest', () => {
		expect(parseHeatPrefs('{"zoom":"day","unit":"nope","thresholds":{"spareBelow":50}}')).toEqual({
			...DEFAULT_HEAT_PREFS,
			zoom: 'day',
		});
		expect(parseHeatPrefs('{"collapsed":["a",3,null,"b"]}').collapsed).toEqual(['a', 'b']);
	});

	it('ignores values that are not what they should be', () => {
		for (const bad of [null, '', 'x', '[]', '1', '{"thresholds":{"spareBelow":90,"overAbove":80}}']) {
			expect(parseHeatPrefs(bad)).toEqual(DEFAULT_HEAT_PREFS);
		}
		expect(parseHeatPrefs('{"thresholds":{"spareBelow":0,"overAbove":100}}').thresholds).toEqual(
			DEFAULT_HEAT_PREFS.thresholds,
		);
	});

	it('validates thresholds: in range, spare not above over', () => {
		expect(validThresholds({ spareBelow: 80, overAbove: 100 })).toBe(true);
		expect(validThresholds({ spareBelow: 100, overAbove: 100 })).toBe(true);
		expect(validThresholds({ spareBelow: 101, overAbove: 100 })).toBe(false);
		expect(validThresholds({ spareBelow: 0, overAbove: 100 })).toBe(false);
		expect(validThresholds({ spareBelow: 80, overAbove: 501 })).toBe(false);
		expect(validThresholds({ spareBelow: NaN, overAbove: 100 })).toBe(false);
	});

	it('survives blocked storage', () => {
		expect(readHeatPrefs(blocked, 'x')).toEqual(DEFAULT_HEAT_PREFS);
		expect(() => writeHeatPrefs(blocked, 'x', DEFAULT_HEAT_PREFS)).not.toThrow();
		expect(readHeatPrefs(null, 'x')).toEqual(DEFAULT_HEAT_PREFS);
	});
});

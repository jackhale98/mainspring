// SPDX-License-Identifier: GPL-2.0-or-later
// Health settings per plan (settings.ts; 18.8, ADR-0008 #3): defaults, a round trip, field-by-field
// reading of bad values, only differences stored, and storage that throws.
import { describe, expect, it } from 'vitest';
import type { PrefStorage } from '../state/storage';
import {
	defaultHealthSettings,
	healthKey,
	parseHealthSettings,
	readHealthSettings,
	serializeHealthSettings,
	withCheck,
	writeHealthSettings,
} from './settings';
import { DEFAULT_HEALTH_SETTINGS } from './types';

function memory(): PrefStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
	};
}

describe('health settings', () => {
	it('defaults to 5 and 20 days with every check on (18.8)', () => {
		expect(readHealthSettings(memory(), 'fedora')).toEqual(DEFAULT_HEALTH_SETTINGS);
		expect(readHealthSettings(null, 'fedora')).toEqual(DEFAULT_HEALTH_SETTINGS);
		expect(defaultHealthSettings()).toEqual(DEFAULT_HEALTH_SETTINGS);
		expect(Object.isFrozen(defaultHealthSettings())).toBe(false);
	});

	it('keeps each plan’s settings under its own key', () => {
		const s = memory();
		const mine = withCheck({ ...defaultHealthSettings(), longGapDays: 10 }, 'long-task', false);
		writeHealthSettings(s, 'a', mine);
		expect(readHealthSettings(s, 'a')).toEqual(mine);
		expect(readHealthSettings(s, 'b')).toEqual(DEFAULT_HEALTH_SETTINGS);
		expect([...s.data.keys()]).toEqual([healthKey('a')]);
		expect(healthKey('a')).toBe('mainspring.health.a');
	});

	it('stores only what differs from the defaults', () => {
		expect(serializeHealthSettings(defaultHealthSettings())).toBe('{}');
		const s = withCheck({ ...defaultHealthSettings(), longTaskDays: 30 }, 'no-successor', false);
		expect(JSON.parse(serializeHealthSettings(s))).toEqual({
			longTaskDays: 30,
			enabled: { 'no-successor': false },
		});
	});

	it('reads field by field: a bad value keeps its default, the rest applies', () => {
		const read = (raw: string | null) => parseHealthSettings(raw);
		expect(read('not json')).toEqual(DEFAULT_HEALTH_SETTINGS);
		expect(read('[1, 2]')).toEqual(DEFAULT_HEALTH_SETTINGS);
		expect(read('null')).toEqual(DEFAULT_HEALTH_SETTINGS);
		const s = read(
			JSON.stringify({
				longGapDays: -1,
				longTaskDays: 12.5,
				enabled: { 'long-gap': false, 'long-task': 'no', nonsense: false },
			}),
		);
		expect(s.longGapDays).toBe(5);
		expect(s.longTaskDays).toBe(12.5);
		expect(s.enabled['long-gap']).toBe(false);
		expect(s.enabled['long-task']).toBe(true);
		expect(Object.keys(s.enabled)).toHaveLength(9);
		expect(read(JSON.stringify({ longGapDays: 1e9, longTaskDays: 'x' }))).toEqual(
			DEFAULT_HEALTH_SETTINGS,
		);
		expect(read(JSON.stringify({ longGapDays: 0 })).longGapDays).toBe(0);
	});

	it('works on when storage throws', () => {
		const broken: PrefStorage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('full');
			},
		};
		expect(readHealthSettings(broken, 'a')).toEqual(DEFAULT_HEALTH_SETTINGS);
		expect(() => writeHealthSettings(broken, 'a', defaultHealthSettings())).not.toThrow();
	});
});

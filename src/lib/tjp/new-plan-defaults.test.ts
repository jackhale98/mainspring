// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { deviceZone, isoDate, zoneChoices } from './new-plan-defaults';

describe('isoDate', () => {
	it('is the local calendar date, padded', () => {
		expect(isoDate(new Date(2026, 10, 4, 23, 59))).toBe('2026-11-04');
		expect(isoDate(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01');
	});
});

describe('zone choices', () => {
	it('lists zones, with the device zone included and UTC left to "None"', () => {
		const zones = zoneChoices('Nowhere/Test');
		expect(zones).toContain('Europe/Berlin');
		expect(zones).toContain('Nowhere/Test');
		expect(zones).not.toContain('UTC');
		expect([...zones].sort()).toEqual([...zones]);
	});
	it('does not repeat the device zone', () => {
		const zones = zoneChoices('Europe/Berlin');
		expect(zones.filter((z) => z === 'Europe/Berlin')).toHaveLength(1);
	});
	it('reads the device zone from Intl, null for UTC', () => {
		const zone = deviceZone();
		expect(zone === null || zone.length > 0).toBe(true);
		expect(zone).not.toBe('UTC');
	});
});

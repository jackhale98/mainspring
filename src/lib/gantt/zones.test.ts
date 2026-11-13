// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../engine/timezone';
import { memoZones } from './zones';

function counted() {
	const host = createTimeZoneHost();
	let calls = 0;
	return {
		get calls() {
			return calls;
		},
		zones: {
			valid: (z: string) => host.valid(z),
			offset: (z: string, e: number) => {
				calls++;
				return host.offset(z, e);
			},
		},
		host,
	};
}

describe('memoZones', () => {
	it('answers as the host does, across clock changes and in other zones', () => {
		const c = counted();
		const memo = memoZones(c.zones);
		const start = Date.UTC(2026, 0, 1) / 1000;
		for (const zone of [
			'Europe/Berlin',
			'America/New_York',
			'Asia/Kathmandu',
			'Australia/Lord_Howe',
		]) {
			for (let t = start; t < start + 366 * 86400; t += 1800 + 7) {
				expect(memo.offset(zone, t)).toBe(c.host.offset(zone, t));
			}
		}
	});

	it('asks the host once per bucket, and not at all for a repeat', () => {
		const c = counted();
		const memo = memoZones(c.zones);
		const t = Date.UTC(2026, 5, 1) / 1000;
		memo.offset('Europe/Berlin', t);
		const after = c.calls;
		for (let i = 0; i < 100; i++) memo.offset('Europe/Berlin', t + i * 8);
		expect(c.calls).toBe(after);
		memo.offset('Europe/Berlin', t + 3600);
		expect(c.calls).toBeGreaterThan(after);
	});

	it('does not cache a bucket across which the offset changes', () => {
		// A host whose offset changes in the middle of the bucket.
		const change = 1_000_000 + 450;
		const zones = {
			valid: () => true,
			offset: (_z: string, e: number) => (e < change ? 3600 : 7200),
		};
		const memo = memoZones(zones, 900);
		const bucket = Math.floor(change / 900) * 900;
		expect(memo.offset('X', bucket)).toBe(3600);
		expect(memo.offset('X', change + 10)).toBe(7200);
		expect(memo.offset('X', change - 10)).toBe(3600);
	});

	it('passes zone validity through', () => {
		const memo = memoZones(createTimeZoneHost());
		expect(memo.valid('Europe/Berlin')).toBe(true);
		expect(memo.valid('Nowhere/Land')).toBe(false);
	});
});

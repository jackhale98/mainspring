// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { lineLabel, relativeTime } from './history-lines';

describe('lineLabel', () => {
	it('names a typing group by its file, and capitalises an intent label', () => {
		expect(lineLabel({ kind: 'typing', label: 'typing', files: ['plan.tjp'] })).toBe(
			'Typing in plan.tjp',
		);
		expect(lineLabel({ kind: 'intent', label: 'set effort', files: ['a.tji'] })).toBe('Set effort');
		expect(
			lineLabel({ kind: 'intent', label: 'Effort of Research: 3d to 4d', files: ['plan.tjp'] }),
		).toBe('Effort of Research: 3d to 4d');
	});
});

describe('relativeTime', () => {
	const now = 1_000_000_000_000;
	it('says just now under a minute, then minutes, hours and days', () => {
		expect(relativeTime(now - 5_000, now)).toBe('just now');
		expect(relativeTime(now - 44_000, now)).toBe('just now');
		expect(relativeTime(now - 60_000, now)).toBe('1 min. ago');
		expect(relativeTime(now - 150_000, now)).toBe('3 min. ago');
		expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hr. ago');
		expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
	});
	it('never reads the future', () => {
		expect(relativeTime(now + 5_000, now)).toBe('just now');
	});
});

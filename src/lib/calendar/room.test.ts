// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { chipRoom, chipsShown } from './room';

describe('chip room of a tall day cell', () => {
	it('counts the lines under the day number', () => {
		expect(chipRoom(0)).toBe(0);
		expect(chipRoom(24)).toBe(0);
		expect(chipRoom(40)).toBe(1);
		expect(chipRoom(88)).toBe(4);
		expect(chipRoom(120)).toBe(6);
	});

	it('shows every chip that fits, and gives one line to "+N more" when some do not', () => {
		expect(chipsShown(0, 3)).toBe(0);
		expect(chipsShown(3, 3)).toBe(3);
		expect(chipsShown(4, 3)).toBe(2);
		expect(chipsShown(9, 1)).toBe(0);
		expect(chipsShown(1, 0)).toBe(0);
		expect(chipsShown(5, 0)).toBe(0);
	});
});

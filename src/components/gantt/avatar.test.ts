// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { avatarColour, initials } from './avatar';

describe('avatar', () => {
	it('takes the first letters of up to two words, upper case', () => {
		expect(initials('Ana López')).toBe('AL');
		expect(initials('dev')).toBe('D');
		expect(initials('Quality Assurance Team')).toBe('QA');
		expect(initials('  spaced   out ')).toBe('SO');
		expect(initials('')).toBe('');
	});
	it('cycles through six colours from 1', () => {
		expect(avatarColour(0)).toBe(1);
		expect(avatarColour(5)).toBe(6);
		expect(avatarColour(6)).toBe(1);
	});
});

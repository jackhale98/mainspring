// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { readPref, writePref, type PrefStorage } from './storage';

function memory(): PrefStorage {
	const data = new Map<string, string>();
	return {
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
	};
}

describe('preference storage', () => {
	it('reads back what it wrote', () => {
		const s = memory();
		writePref(s, 'a', 'b');
		expect(readPref(s, 'a')).toBe('b');
		expect(readPref(s, 'missing')).toBeNull();
	});

	it('treats a missing or throwing storage as no preference', () => {
		const broken: PrefStorage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('full');
			},
		};
		expect(readPref(null, 'a')).toBeNull();
		expect(readPref(broken, 'a')).toBeNull();
		expect(() => writePref(broken, 'a', 'b')).not.toThrow();
		expect(() => writePref(null, 'a', 'b')).not.toThrow();
	});
});

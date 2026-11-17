// SPDX-License-Identifier: GPL-2.0-or-later
// prefs.ts repeats the guarded storage of state/storage.ts so that a lazy chunk does not import it; the
// two behave alike: the same storage when it can be reached, and a missing, throwing or full one means
// "no preference" and never an error.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserStorage as original, readPref, writePref } from '../state/storage';
import { browserStorage, readRatio, tableRatioKey, TABLE_RATIO_DEFAULT, writeRatio } from './prefs';

afterEach(() => vi.unstubAllGlobals());

describe('browserStorage', () => {
	it('is the same storage, or null, as the shared one', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(browserStorage()).toBe(original());
		const store = { getItem: () => null, setItem: () => undefined };
		vi.stubGlobal('localStorage', store);
		expect(browserStorage()).toBe(store);
		expect(original()).toBe(store);
	});

	it('is null when reaching the storage throws, as the shared one is', () => {
		vi.stubGlobal('localStorage', undefined);
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('blocked');
			},
		});
		expect(browserStorage()).toBeNull();
		expect(original()).toBeNull();
	});
});

describe('the guarded reads and writes', () => {
	const throwing = {
		getItem: () => {
			throw new Error('blocked');
		},
		setItem: () => {
			throw new Error('full');
		},
	};

	it('read as no preference, and write nothing, when the storage throws', () => {
		expect(readPref(throwing, 'k')).toBeNull();
		expect(readRatio(throwing, 'plan')).toBe(TABLE_RATIO_DEFAULT);
		expect(() => writePref(throwing, 'k', 'v')).not.toThrow();
		expect(() => writeRatio(throwing, 'plan', 0.5)).not.toThrow();
	});

	it('read back what the shared writer wrote, under the same key rules', () => {
		const map = new Map<string, string>();
		const store = {
			getItem: (k: string) => map.get(k) ?? null,
			setItem: (k: string, v: string) => void map.set(k, v),
		};
		writePref(store, tableRatioKey('p'), '0.55');
		expect(readRatio(store, 'p')).toBe(0.55);
		writeRatio(store, 'q', 0.3);
		expect(readPref(store, tableRatioKey('q'))).toBe('0.3');
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The browser's `localStorage` for UI preferences only (ADR-0008 #3): the theme, the mode and
 * the divider of each sample. No plan text is ever stored. Storage can be missing, full or
 * blocked (private windows, site settings), so every read and write is guarded: a failure means
 * "no preference" and the app keeps working from its defaults.
 */
export interface PrefStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** `localStorage` when it can be reached, else null. */
export function browserStorage(): PrefStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export function readPref(storage: PrefStorage | null, key: string): string | null {
	try {
		return storage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

export function writePref(storage: PrefStorage | null, key: string, value: string): void {
	try {
		storage?.setItem(key, value);
	} catch {
		// Storage full or blocked: the preference lasts until the page closes.
	}
}

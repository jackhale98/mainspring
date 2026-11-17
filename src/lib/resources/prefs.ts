// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The divider between the resource table and the lanes (phase-3.md 9.2, ADR-0008 #3): the table
 * pane's share of the Resources view's width, kept per plan in `localStorage` as a UI preference
 * (never plan text). Anything missing or out of range falls back to the default, so a value written
 * by another version, or by hand, never breaks the view. Blocked or full storage means "the default".
 */

/** What the preference needs of `localStorage` (state/storage.ts's `PrefStorage`, repeated). */
export interface PrefStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/**
 * `localStorage` when it can be reached, else null; and guarded reads and writes: a failure means
 * "the default". These repeat the few lines of state/storage.ts on purpose: this module is read by a
 * lazy chunk only, and importing the shared one made the bundler cut it out of the first load's chunk
 * as a chunk of its own (phase-3.md 23.1).
 */
export function browserStorage(): PrefStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function readPref(storage: PrefStorage | null, key: string): string | null {
	try {
		return storage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

function writePref(storage: PrefStorage | null, key: string, value: string): void {
	try {
		storage?.setItem(key, value);
	} catch {
		// Storage full or blocked: the preference lasts until the page closes.
	}
}

export const TABLE_RATIO_DEFAULT = 0.4;
/** Neither pane can be dragged shut: the lanes keep 30% and the table a fifth. */
export const TABLE_RATIO_LIMITS = { min: 0.2, max: 0.7 } as const;

export const tableRatioKey = (plan: string): string => `mainspring.resources.table.${plan}`;

export function clampRatio(value: number): number {
	if (!Number.isFinite(value)) return TABLE_RATIO_DEFAULT;
	return Math.min(TABLE_RATIO_LIMITS.max, Math.max(TABLE_RATIO_LIMITS.min, value));
}

/** The ratio a stored string holds, or the default. */
export function parseRatio(raw: string | null): number {
	if (raw === null) return TABLE_RATIO_DEFAULT;
	const n = Number(raw);
	return raw.trim() !== '' && Number.isFinite(n) ? clampRatio(n) : TABLE_RATIO_DEFAULT;
}

export const readRatio = (storage: PrefStorage | null, plan: string): number =>
	parseRatio(readPref(storage, tableRatioKey(plan)));

export const writeRatio = (storage: PrefStorage | null, plan: string, value: number): void =>
	writePref(storage, tableRatioKey(plan), String(Math.round(clampRatio(value) * 1000) / 1000));

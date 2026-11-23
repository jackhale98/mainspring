// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The browser's `localStorage` for UI preferences only (ADR-0008 #3, amended 2026-11-23): the
 * theme, the mode and the dividers of each plan, and which plan was open last. Plan text is never
 * kept here: the local store (storage/local-store.ts, IndexedDB) keeps it. Storage can be missing,
 * full or blocked (private windows, site settings), so every read and write is guarded: a failure
 * means "no preference" and the app keeps working from its defaults.
 *
 * - **Per plan.** A preference of one plan is `mainspring.<what>.<plan>`: the plan part is a sample's
 *   id while the sample is open unstored, and `planKey(id)` (`ws:<id>`, state/app-storage.ts) for a
 *   stored plan. When a sample's first change stores its copy (18.7), the sample's preferences are
 *   copied to the copy once, as its defaults (plan-keeper.ts); the sample keeps its own.
 * - **The last plan** (18.7): the plan key of the plan opened last (`LAST_PLAN_KEY`), which opens on
 *   start when the address names no sample.
 */
export interface PrefStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** `localStorage`, which can list its keys (plan-keeper.ts `copyPlanPrefs`). */
export type ListedStorage = PrefStorage & Pick<Storage, 'key' | 'length'>;

/** The plan key (a sample's id, or `ws:<id>`) of the plan opened last. */
export const LAST_PLAN_KEY = 'mainspring.last-plan';
/** `localStorage`'s half of the eviction marker (storage/local-store.ts, phase-4.md 9.4). */
export const MARKER_KEY = 'mainspring.stored';

/** `localStorage` when it can be reached, else null. */
export function browserStorage(): ListedStorage | null {
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

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the Gantt's filter is (phase-3.md "Amendments from T19"): a person and a flag, either of
 * them optional. Kept apart from filter.ts, which does the work and is fetched only when a filter
 * is on or its panel is open (the first-load JS budget); the state class needs only this.
 */
export interface GanttFilter {
	/** A resource id, or null for anyone. */
	readonly person: string | null;
	/** A flag name, or null for any. */
	readonly flag: string | null;
}

export const NO_FILTER: GanttFilter = { person: null, flag: null };

export const isFiltering = (f: GanttFilter): boolean => f.person !== null || f.flag !== null;

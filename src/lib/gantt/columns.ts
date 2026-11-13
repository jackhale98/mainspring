// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The columns of the Gantt's task table (phase-2.md 10.1) and their natural widths.
 *
 * Every column is always in the treegrid, so a screen reader finds the same table at every width.
 * On a desktop and a tablet every column is drawn at its natural width: the divider between the
 * table and the chart (table.ts) decides how much of the table shows, and the table scrolls
 * sideways inside its pane, behind the frozen name column (ADR-0008, amendment 2026-11-13; this
 * replaced T18's choice of which columns fit). A phone draws the name column alone, as before; the
 * other cells are visually hidden, not removed, and keyboard focus skips them (a focus ring on
 * something unseen fails WCAG 2.4.7).
 *
 * Widths are in rem so that they follow the reader's text size; the name column's own width is
 * a CSS token and is measured, not repeated here.
 */

export type ColumnId =
	'name' | 'start' | 'end' | 'effort' | 'people' | 'float' | 'critical' | 'status';

/** The cells' order, as in phase-2.md 10.1 (the name first). */
export const COLUMN_ORDER: readonly ColumnId[] = [
	'name',
	'start',
	'end',
	'effort',
	'people',
	'float',
	'critical',
	'status',
];

/** The width of each column but the name, in rem. */
export const COLUMN_REM: Readonly<Record<Exclude<ColumnId, 'name'>, number>> = {
	start: 6.5,
	end: 6.5,
	effort: 6,
	people: 7,
	float: 8.25,
	critical: 6,
	status: 6.25,
};

/** The columns the divider's default position shows: the name, the dates and the effort. */
export const DEFAULT_COLUMNS: readonly ColumnId[] = ['name', 'start', 'end', 'effort'];

/** The columns drawn: all of them, or on a phone the name alone. */
export function shownColumns(phone: boolean): readonly ColumnId[] {
	return phone ? ['name'] : COLUMN_ORDER;
}

/** The width of the columns but the name, in rem. */
export function extrasRem(columns: readonly ColumnId[]): number {
	let rem = 0;
	for (const id of columns) {
		const w = widthOf(id);
		if (w !== null) rem += w;
	}
	return rem;
}

/** The width of a column in rem, or null for the name (which is a token). */
export function widthOf(id: ColumnId): number | null {
	return id === 'name' ? null : COLUMN_REM[id];
}

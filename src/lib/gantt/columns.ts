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
	| 'number'
	| 'name'
	| 'start'
	| 'end'
	| 'effort'
	| 'people'
	| 'float'
	| 'critical'
	| 'status'
	| 'predecessors'
	| 'successors';

/**
 * The cells' order, as in phase-2.md 10.1 with polish item 16: the row number and the name (both
 * frozen, MS Project style), the schedule's columns, then the links.
 */
export const COLUMN_ORDER: readonly ColumnId[] = [
	'number',
	'name',
	'start',
	'end',
	'effort',
	'people',
	'float',
	'critical',
	'status',
	'predecessors',
	'successors',
];

/**
 * The width of each column but the name, in rem. The row number is 2.25 rem: three digits and
 * a little air, so that it and the name still read in the table's least width of 10 rem (table.ts).
 */
export const COLUMN_REM: Readonly<Record<Exclude<ColumnId, 'name'>, number>> = {
	number: 2.25,
	start: 6.5,
	end: 6.5,
	effort: 6,
	people: 7,
	float: 8.25,
	critical: 6,
	status: 6.25,
	predecessors: 8,
	successors: 8,
};

/**
 * The width of the # column for a plan of `rows` tasks, in rem: `COLUMN_REM.number` (room for three
 * digits) and half a rem for each digit more, so that a number is never clipped.
 */
export function numberColumnRem(rows: number): number {
	const digits = String(Math.max(1, Math.floor(rows))).length;
	return COLUMN_REM.number + Math.max(0, digits - 3) * 0.5;
}

/** The widest column but the name, in rem. */
export const WIDEST_COLUMN_REM = Math.max(...Object.values(COLUMN_REM));

/** The columns the divider's default position shows: the number, the name, the dates and the effort. */
export const DEFAULT_COLUMNS: readonly ColumnId[] = ['number', 'name', 'start', 'end', 'effort'];

/** The columns that stay at the table's left while the others scroll under them. */
export const FROZEN_COLUMNS: readonly ColumnId[] = ['number', 'name'];

/**
 * How much of the table is drawn: `full`, every column; `narrow`, the pane has no room for a
 * column beside the frozen two (polish item 13), so only the row number and the name show, as
 * MS Project keeps the ID beside the name; `phone`, the name alone (the number is in the table for
 * a screen reader, but a phone's name column is too narrow to spend on it).
 */
export type TableFit = 'full' | 'narrow' | 'phone';

/** The columns drawn at a fit. */
export function shownColumns(fit: TableFit): readonly ColumnId[] {
	return fit === 'phone' ? ['name'] : fit === 'narrow' ? FROZEN_COLUMNS : COLUMN_ORDER;
}

/** The width of the columns but the name, in rem; `numberRem` is the # column's (`numberColumnRem`). */
export function extrasRem(
	columns: readonly ColumnId[],
	numberRem: number = COLUMN_REM.number,
): number {
	let rem = 0;
	for (const id of columns) {
		const w = widthOf(id, numberRem);
		if (w !== null) rem += w;
	}
	return rem;
}

/** The width of a column in rem, or null for the name (which is a token). */
export function widthOf(id: ColumnId, numberRem: number = COLUMN_REM.number): number | null {
	return id === 'name' ? null : id === 'number' ? numberRem : COLUMN_REM[id];
}

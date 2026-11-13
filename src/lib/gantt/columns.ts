// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The columns of the Gantt's task list (phase-2.md 10.1) and which of them are on screen.
 *
 * Every column is always in the treegrid, so a screen reader finds the same table at every width
 * (a phone's task list is a table of eight columns for it, and the name for the eye). What the
 * width decides is which cells are drawn: the name always, then the others in order of use while
 * the chart keeps at least `MIN_CHART_REM` to its right. The rest are visually hidden, not
 * removed, and keyboard focus skips them (a focus ring on something unseen fails WCAG 2.4.7).
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

/**
 * The columns shown, by priority: the first that does not fit ends the list. Critical comes
 * before the float and the people because it is the words that say what the bar's heavier edge
 * only draws (WCAG 1.4.1); the people are also on the bars.
 */
const PRIORITY: readonly Exclude<ColumnId, 'name'>[] = [
	'start',
	'end',
	'effort',
	'critical',
	'float',
	'people',
	'status',
];

/** The chart keeps at least this much to the right of the task list, in rem... */
export const MIN_CHART_REM = 24;
/** ...and at least this share of the Gantt's width, so the chart stays the main thing. */
export const MIN_CHART_SHARE = 0.4;

export interface ColumnLayout {
	/** The columns drawn, in cell order, the name first. */
	readonly shown: readonly ColumnId[];
	/** The width of everything but the name, in rem. */
	readonly extraRem: number;
}

/**
 * Which columns fit. `ganttPx` is the Gantt's width, `nameColPx` the name column's own width and
 * `remPx` the size of a rem, all in CSS px.
 */
export function layoutColumns(ganttPx: number, nameColPx: number, remPx: number): ColumnLayout {
	const chart = Math.max(MIN_CHART_REM, (MIN_CHART_SHARE * ganttPx) / (remPx || 1));
	const room = remPx > 0 ? (ganttPx - nameColPx) / remPx - chart : 0;
	const shown: ColumnId[] = ['name'];
	let used = 0;
	for (const id of PRIORITY) {
		const w = COLUMN_REM[id];
		if (used + w > room) break;
		used += w;
		shown.push(id);
	}
	// Cell order, not priority order (people comes before float, as the cells do).
	return {
		shown: COLUMN_ORDER.filter((c) => shown.includes(c)),
		extraRem: used,
	};
}

/** The width of a column in rem, or null for the name (which is a token). */
export function widthOf(id: ColumnId): number | null {
	return id === 'name' ? null : COLUMN_REM[id];
}

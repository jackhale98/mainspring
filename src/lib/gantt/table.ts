// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The divider between the Gantt's task table and its chart (ADR-0008, amendment 2026-11-13): pure
 * rules for how wide the table's pane is, so that the component only reads events.
 *
 * The divider's position is a ratio, the table pane's share of the Gantt's width. It is kept
 * within limits so that neither pane can be dragged shut: the chart keeps a fifth of the width, and
 * the table pane is never narrower than `leastTableWidth` (polish item 13: the frozen Task column
 * alone at a readable width, names clipped with an ellipsis). The divider reports those limits (`tableLimits`).
 * While the pane is wide enough for a name and the widest other column (`columnsFit`) the table
 * has its columns, which scroll beside the frozen name and are scrolled into view when they take
 * the keyboard focus (WCAG 2.4.7, 2.4.11); narrower, it is the name column alone, as on a phone,
 * and focus skips the cells it does not draw.
 * Without a stored position the pane is as wide as the default columns (columns.ts
 * `DEFAULT_COLUMNS`) need, when the chart then keeps at least `MIN_CHART_SHARE` of the width, and
 * as wide as that rule allows when it does not (the table then scrolls sideways).
 */
import { MAX_RATIO, type RatioLimits } from '../state/split';
import { WIDEST_COLUMN_REM } from './columns';

/**
 * The table divider may go lower than the Split divider's fifth: only the pane's real least width
 * (below) matters. This is the floor of the ratio itself, so that a stored position or a pointer
 * on a very wide window is still a sane number; the real limit is `tableLimits`.
 */
export const TABLE_MIN_RATIO = 0.01;

export function clampTableRatio(value: number, limits?: RatioLimits): number {
	const min = limits?.min ?? TABLE_MIN_RATIO;
	const max = limits?.max ?? MAX_RATIO;
	if (!Number.isFinite(value)) return Math.max(min, Math.min(max, 0.4));
	return Math.min(max, Math.max(Math.min(min, max), value));
}

/** The chart keeps at least this share of the Gantt's width at the default position. */
export const MIN_CHART_SHARE = 0.4;

/**
 * The least the table pane is, in rem: the Task column alone at a readable width, names clipped
 * with an ellipsis (10 rem is 160 px at the default text size, about a dozen characters beside
 * the twisty). A 44 px strip was tried too (polish item 13): it shows only the twisties and the
 * first letter of a name, so it does not read and is not the limit.
 */
export const LEAST_TABLE_REM = 10;

/** The least the table pane is, in px, at the reader's text size. */
export function leastTableWidth(remPx: number): number {
	return Math.round(LEAST_TABLE_REM * remPx);
}

/** Whether a pane is wide enough for the name column and the widest other column beside it. */
export function columnsFit(panePx: number, nameColPx: number, remPx: number): boolean {
	return panePx >= nameColPx + WIDEST_COLUMN_REM * remPx - 1;
}

export interface TableSpace {
	/** The Gantt's width, and the divider's own. */
	readonly ganttPx: number;
	readonly dividerPx: number;
	/** The least the pane is (`leastTableWidth`). */
	readonly leastPx: number;
}

/** The divider's limits as ratios: the pane's least width at the low end, a fifth for the chart at the high. */
export function tableLimits(s: TableSpace): RatioLimits {
	if (!(s.ganttPx > 0)) return { min: TABLE_MIN_RATIO, max: MAX_RATIO };
	const min = (s.leastPx + s.dividerPx / 2) / s.ganttPx;
	return { min: Math.min(MAX_RATIO, Math.max(TABLE_MIN_RATIO, min)), max: MAX_RATIO };
}

/**
 * The default ratio: the default columns' width over the Gantt's, within what the chart needs.
 * The ratio is where the divider's centre is, so half the divider is added to the columns.
 */
export function defaultTableRatio(
	ganttPx: number,
	defaultColumnsPx: number,
	dividerPx = 0,
): number {
	if (!(ganttPx > 0)) return clampTableRatio(Number.NaN);
	return clampTableRatio(
		Math.min((defaultColumnsPx + dividerPx / 2) / ganttPx, 1 - MIN_CHART_SHARE),
	);
}

export interface TableWidthInput extends TableSpace {
	/** The ratio: the stored one, else the default. */
	readonly ratio: number;
}

/**
 * The table pane's width in px. The divider's centre is where the ratio says, so the pane ends
 * half a divider before it; it is within the limits of `tableLimits`.
 */
export function tableWidth(i: TableWidthInput): number {
	const { ganttPx, dividerPx, leastPx } = i;
	if (!(ganttPx > 0)) return Math.max(0, leastPx);
	const most = MAX_RATIO * ganttPx - dividerPx;
	const raw = clampTableRatio(i.ratio, tableLimits(i)) * ganttPx - dividerPx / 2;
	return Math.round(Math.max(Math.min(leastPx, most), Math.min(raw, most)));
}

/** Reads a stored ratio; anything malformed is no stored position (the default applies). */
export function parseTableRatio(text: string | null): number | null {
	if (text === null) return null;
	const v = Number.parseFloat(text);
	return Number.isFinite(v) ? clampTableRatio(v) : null;
}

export function serializeTableRatio(ratio: number): string {
	return String(Number(clampTableRatio(ratio).toFixed(4)));
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The divider between the Gantt's task table and its chart (ADR-0008, amendment 2026-11-13): pure
 * rules for how wide the table's pane is, so that the component only reads events.
 *
 * The divider's position is a ratio, the table pane's share of the Gantt's width. It is kept
 * within limits so that neither pane can be dragged shut: the chart keeps a fifth of the width, and
 * the table pane is never narrower than the frozen name column and the widest other column
 * (`leastTableWidth`), so that a cell with the keyboard focus can always be scrolled fully into
 * view beside the name (WCAG 2.4.7, 2.4.11). The divider reports those limits (`tableLimits`).
 * Without a stored position the pane is as wide as the default columns (columns.ts
 * `DEFAULT_COLUMNS`) need, when the chart then keeps at least `MIN_CHART_SHARE` of the width, and
 * as wide as that rule allows when it does not (the table then scrolls sideways).
 */
import { clampRatio, MAX_RATIO, MIN_RATIO, type RatioLimits } from '../state/split';
import { WIDEST_COLUMN_REM } from './columns';

/** The chart keeps at least this share of the Gantt's width at the default position. */
export const MIN_CHART_SHARE = 0.4;

/** The least the table pane is: the name column and the widest other column. */
export function leastTableWidth(nameColPx: number, remPx: number): number {
	return nameColPx + WIDEST_COLUMN_REM * remPx;
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
	if (!(s.ganttPx > 0)) return { min: MIN_RATIO, max: MAX_RATIO };
	const min = (s.leastPx + s.dividerPx / 2) / s.ganttPx;
	return { min: Math.min(MAX_RATIO, Math.max(MIN_RATIO, min)), max: MAX_RATIO };
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
	if (!(ganttPx > 0)) return clampRatio(Number.NaN);
	return clampRatio(Math.min((defaultColumnsPx + dividerPx / 2) / ganttPx, 1 - MIN_CHART_SHARE));
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
	const raw = clampRatio(i.ratio, tableLimits(i)) * ganttPx - dividerPx / 2;
	return Math.round(Math.max(Math.min(leastPx, most), Math.min(raw, most)));
}

/** Reads a stored ratio; anything malformed is no stored position (the default applies). */
export function parseTableRatio(text: string | null): number | null {
	if (text === null) return null;
	const v = Number.parseFloat(text);
	return Number.isFinite(v) ? clampRatio(v) : null;
}

export function serializeTableRatio(ratio: number): string {
	return String(Number(clampRatio(ratio).toFixed(4)));
}

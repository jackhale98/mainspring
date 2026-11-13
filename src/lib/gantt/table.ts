// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The divider between the Gantt's task table and its chart (ADR-0008, amendment 2026-11-13): pure
 * rules for how wide the table's pane is, so that the component only reads events.
 *
 * The divider's position is a ratio, the table pane's share of the Gantt's width, kept within the
 * Split divider's limits (state/split.ts) so that neither pane can be dragged shut. Without a
 * stored position the pane is as wide as the default columns (columns.ts `DEFAULT_COLUMNS`) need,
 * when the chart then keeps at least `MIN_CHART_SHARE` of the width, and as wide as that rule
 * allows when it does not (the table then scrolls sideways). The name column is never cut: the
 * pane is at least as wide as it, or half the Gantt where that is less.
 */
import { clampRatio, MAX_RATIO } from '../state/split';

/** The chart keeps at least this share of the Gantt's width at the default position. */
export const MIN_CHART_SHARE = 0.4;

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

export interface TableWidthInput {
	/** The ratio: the stored one, else the default. */
	readonly ratio: number;
	/** The Gantt's width, and the divider's own. */
	readonly ganttPx: number;
	readonly dividerPx: number;
	/** The name column's width: the least the pane shows. */
	readonly nameColPx: number;
}

/**
 * The table pane's width in px. The divider's centre is where the ratio says, so the pane ends
 * half a divider before it; it is not narrower than the name column (unless that is over half the
 * Gantt) and leaves the chart a fifth of the width at least.
 */
export function tableWidth(i: TableWidthInput): number {
	const { ganttPx, dividerPx, nameColPx } = i;
	if (!(ganttPx > 0)) return Math.max(0, nameColPx);
	const raw = clampRatio(i.ratio) * ganttPx - dividerPx / 2;
	const least = Math.min(nameColPx, ganttPx * 0.5);
	const most = MAX_RATIO * ganttPx - dividerPx;
	return Math.round(Math.max(least, Math.min(raw, most)));
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

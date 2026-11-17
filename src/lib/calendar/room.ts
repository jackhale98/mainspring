// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * How many chips a day cell of the month that fills the view can show (phase-3.md 22.x, amended
 * 2026-11-17): every chip that fits in the cell under the day number, and when they do not all
 * fit, as many as leave one line for the "+N more" button, so the cell never says "+1 more" where
 * the one chip would have fit and nothing is cut off by the cell's edge.
 *
 * The sizes are the cell's own and are shared with the stylesheet: MonthView.svelte sets them as
 * CSS custom properties on the month from these constants, and its fill rules size the day
 * number, the chips and the button by them, so the arithmetic here is the layout.
 *
 * Pure: the caller works out the height of a week row (the grid's height less its weekday row,
 * over the number of rows, so it is right in the same frame as a change from 6 rows to 5) and each
 * day asks `chipsShown`.
 */

/** The day number's line (px). */
export const NUM_H = 18;
/** The cell's top border and padding (1 and 2 px) and the day number's line: what is above the chips. */
export const CELL_HEAD = 1 + 2 + NUM_H;
/** A chip: 15 px of text and a 1 px border above and below (px). */
export const CHIP_H = 17;
/** The gap between lines in the cell (px). */
export const CHIP_GAP = 1;
/** One chip and the gap after it (px). */
export const CHIP_PITCH = CHIP_H + CHIP_GAP;
/** The "+N more" button's line (px). */
export const MORE_H = 15;

/** How many of `total` chips to show in a row of `rowHeight` px: all, or fewer, for "+N more". */
export function chipsShown(total: number, rowHeight: number): number {
	const room = rowHeight - CELL_HEAD;
	if (total <= 0) return 0;
	// All of them: `total` chips with a gap between each.
	if (total * CHIP_PITCH - CHIP_GAP <= room) return total;
	// Some, then the button: each chip with its gap, then the button's line.
	return Math.max(0, Math.min(total - 1, Math.floor((room - MORE_H) / CHIP_PITCH)));
}

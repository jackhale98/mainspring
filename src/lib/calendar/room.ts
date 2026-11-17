// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * How many chips a day cell of the month that fills the view can show (phase-3.md 22.x, amended
 * 2026-11-17): as many as fit in the row's height, and when there are more, one line of the room is
 * the "+N more" button, so the cell never says "+1 more" where the one chip would have fit.
 *
 * Pure: the caller measures one week row of the month (a resize, never a scroll or a drag frame)
 * and each day asks `chipsShown`. The sizes are the cell's own (MonthView.svelte): the padding and
 * the day number above the chips, and a chip line of 15 px plus a 1 px gap.
 */

/** The cell's padding and the day number above its chips, in px. */
export const CELL_HEAD = 24;
/** One chip line: 15 px of line and a 1 px gap. */
export const CHIP_LINE = 16;

/** The lines of chips a row of `rowHeight` px has room for. */
export const chipRoom = (rowHeight: number): number =>
	rowHeight > CELL_HEAD ? Math.floor((rowHeight - CELL_HEAD) / CHIP_LINE) : 0;

/** How many of `total` chips to show in `room` lines: all, or one line fewer for "+N more". */
export const chipsShown = (total: number, room: number): number =>
	total <= room ? total : Math.max(0, room - 1);

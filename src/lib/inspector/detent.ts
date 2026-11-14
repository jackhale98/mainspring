// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The bottom sheet's heights (phase-2.md 9.2, polish item 8): half the viewport, or dragged up to
 * nearly all of it, or a peek (the grabber and the header) that the Gantt uses while a link is made
 * or a row is lifted, so that the chart's rows stay in reach (T16). The drag has a keyboard and tap alternative (the grabber is a button that
 * toggles the two), as WCAG 2.5.7 asks. Pure rules; Sheet.svelte does the pointer work.
 */
export type Detent = 'half' | 'full' | 'peek';

/** A drag shorter than this (px) is a tap on the grabber, which toggles the height. */
export const TAP_SLOP = 6;
/** How far (px) a drag must go to change the height. */
export const SNAP_DISTANCE = 48;

/**
 * Where a drag that moved the grabber `dy` px down (negative: up) ends. From half, a drag up goes
 * to full and one down closes; from full, a drag down goes back to half.
 */
export function detentAfterDrag(from: Detent, dy: number): Detent | 'close' {
	// A peek opens to half on a drag up and stays a peek otherwise (it is not the person's height).
	if (from === 'peek') return dy <= -SNAP_DISTANCE ? 'half' : 'peek';
	if (from === 'half') {
		if (dy <= -SNAP_DISTANCE) return 'full';
		return dy >= SNAP_DISTANCE ? 'close' : 'half';
	}
	return dy >= SNAP_DISTANCE ? 'half' : 'full';
}

/** The other height, for a tap or key on the grabber. */
export const toggled = (d: Detent): Detent => (d === 'half' ? 'full' : 'half');
// (A peek toggles to half: it is neither of the two.)

/** The height (px) the sheet follows the pointer at during a drag, kept on screen. */
export function dragHeight(start: number, dy: number, viewport: number): number {
	return Math.max(0, Math.min(viewport, start - dy));
}

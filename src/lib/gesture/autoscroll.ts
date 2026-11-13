// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Edge auto-scroll during a drag (phase-2.md 7.2): up to 600 px/s, ramping up as the pointer
 * nears the edge of the viewport. Pure: the wiring multiplies by the frame time, scrolls, and
 * sends a synthetic `move` with the new content coordinates so the drag follows the scroll.
 */
export const AUTOSCROLL_MAX_PX_PER_S = 600;
/** The band inside each edge where scrolling ramps up, in CSS px. */
export const AUTOSCROLL_EDGE_PX = 48;

/**
 * Signed velocity in px/s for a pointer at `pos` in a viewport spanning [`min`, `max`] on one axis:
 * negative toward `min`, positive toward `max`, zero in the middle. A pointer past the edge
 * scrolls at the full speed.
 */
export function autoScrollVelocity(
	pos: number,
	min: number,
	max: number,
	edge: number = AUTOSCROLL_EDGE_PX,
	maxSpeed: number = AUTOSCROLL_MAX_PX_PER_S,
): number {
	// A viewport too small for two bands splits the space instead of overlapping the bands.
	const band = Math.max(0, Math.min(edge, (max - min) / 2));
	if (band === 0) return 0;
	if (pos < min + band) return -maxSpeed * Math.min(1, (min + band - pos) / band);
	if (pos > max - band) return maxSpeed * Math.min(1, (pos - (max - band)) / band);
	return 0;
}

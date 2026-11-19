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

/**
 * How far toward an edge a pointer that began its drag inside that edge's band must move before
 * the band scrolls (CSS px). Past the press slop of every pointer kind, so a wobble does not arm it.
 */
export const AUTOSCROLL_ARM_PX = 12;

/**
 * Where a drag began inside each band of one axis, or null where it did not (that band is armed).
 * A band that holds scrolls nothing: a drag that starts in the band, say on the size handle of a bar
 * whose end is near the screen's edge, and moves away from the edge would otherwise have the chart
 * run under the pointer toward that edge, and the two movements cancel out (the drag makes no
 * change, or a smaller one than the pointer travelled).
 */
export interface AxisHold {
	readonly min: number | null;
	readonly max: number | null;
}

export const NO_HOLD: AxisHold = { min: null, max: null };

const bandOf = (min: number, max: number, edge: number): number =>
	Math.max(0, Math.min(edge, (max - min) / 2));

/** The holds of a drag that began with the pointer at `pos` in a viewport spanning [`min`, `max`]. */
export function holdAt(
	pos: number,
	min: number,
	max: number,
	edge: number = AUTOSCROLL_EDGE_PX,
): AxisHold {
	const band = bandOf(min, max, edge);
	if (band === 0) return NO_HOLD;
	return {
		min: pos < min + band ? pos : null,
		max: pos > max - band ? pos : null,
	};
}

/**
 * The velocity for a pointer now (as `autoScrollVelocity`, except that a band that holds is quiet)
 * and the holds after it. A hold ends when the pointer leaves its band, or goes `AUTOSCROLL_ARM_PX`
 * toward its edge from where the drag began; after that the band scrolls as any other.
 */
export function heldVelocity(
	hold: AxisHold,
	pos: number,
	min: number,
	max: number,
	edge: number = AUTOSCROLL_EDGE_PX,
	maxSpeed: number = AUTOSCROLL_MAX_PX_PER_S,
): { readonly velocity: number; readonly hold: AxisHold } {
	const band = bandOf(min, max, edge);
	const lo = hold.min !== null && pos < min + band && pos > hold.min - AUTOSCROLL_ARM_PX;
	const hi = hold.max !== null && pos > max - band && pos < hold.max + AUTOSCROLL_ARM_PX;
	const next: AxisHold = { min: lo ? hold.min : null, max: hi ? hold.max : null };
	const v = autoScrollVelocity(pos, min, max, edge, maxSpeed);
	const quiet = (v < 0 && next.min !== null) || (v > 0 && next.max !== null);
	return { velocity: quiet ? 0 : v, hold: next };
}

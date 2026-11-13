// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Two-finger gesture math (phase-2.md 7.2): pinch scales time around the centroid where the
 * fingers began, and moving the centroid pans. Both start only after a small dead zone, so a
 * two-finger pan does not zoom by jitter and a pinch does not drift.
 */
import type { Minutes } from '../../engine/protocol';

export interface Pt {
	readonly x: number;
	readonly y: number;
}

export interface PinchFrame {
	/** Cumulative scale since the pinch engaged (1 at that moment), or null while not engaged. */
	readonly scale: number | null;
	/** Incremental centroid movement since the last frame, or null while inside the dead zone. */
	readonly pan: { readonly dx: number; readonly dy: number } | null;
}

export interface PinchTracker {
	/** The centroid where the two fingers began: the zoom anchor. */
	readonly anchor: Pt;
	update(a: Pt, b: Pt): PinchFrame;
}

/**
 * The narrowest horizontal finger gap a pinch can engage at. Time runs left to right, so only the
 * horizontal gap zooms it; two fingers stacked vertically have a gap near zero, and a ratio of two
 * tiny numbers would be noise.
 */
export const MIN_PINCH_SPAN = 24;

const centroid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const span = (a: Pt, b: Pt): number => Math.abs(b.x - a.x);

/**
 * Both points are in viewport coordinates: a scroll the wiring does in response must not read as
 * finger movement. `slop` is the dead zone in px for the gap and for the centroid. When scaling
 * engages the reference gap is rebased to the current one, so the scale starts at exactly 1
 * instead of jumping by the dead zone.
 */
export function createPinchTracker(a: Pt, b: Pt, slop: number): PinchTracker {
	const anchor = centroid(a, b);
	const span0 = span(a, b);
	let base = 0; // the gap the scale is measured against; 0 until scaling engages
	let panning = false;
	let last = anchor;
	return {
		anchor,
		update(p, q) {
			const c = centroid(p, q);
			const d = span(p, q);
			if (base === 0 && Math.abs(d - span0) > slop && d >= MIN_PINCH_SPAN) base = d;
			if (!panning && Math.hypot(c.x - anchor.x, c.y - anchor.y) > slop) panning = true;
			let pan: PinchFrame['pan'] = null;
			if (panning) {
				pan = { dx: c.x - last.x, dy: c.y - last.y };
				last = c;
			}
			return { scale: base === 0 ? null : Math.max(d, 1) / base, pan };
		},
	};
}

/**
 * The `scrollLeft` that keeps `anchorMin` under viewport x `anchorViewportX` after a zoom to
 * `pxPerMin` (content x of a minute is `(m - originMin) * pxPerMin`).
 */
export function scrollLeftForAnchor(
	anchorMin: Minutes,
	anchorViewportX: number,
	originMin: Minutes,
	pxPerMin: number,
): number {
	return (anchorMin - originMin) * pxPerMin - anchorViewportX;
}

/** A pinch's new zoom from the zoom it began with, clamped by the caller's bounds. */
export function pinchZoom(startPxPerDay: number, scale: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, startPxPerDay * scale));
}

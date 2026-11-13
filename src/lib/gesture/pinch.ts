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
	/** Cumulative scale since the pinch began, or null while inside the dead zone. */
	readonly scale: number | null;
	/** Incremental centroid movement since the last frame, or null while inside the dead zone. */
	readonly pan: { readonly dx: number; readonly dy: number } | null;
}

export interface PinchTracker {
	/** The centroid where the two fingers began: the zoom anchor. */
	readonly anchor: Pt;
	update(a: Pt, b: Pt): PinchFrame;
}

const centroid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const gap = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

/** `slop` is the dead zone in px, for the distance between the fingers and for the centroid. */
export function createPinchTracker(a: Pt, b: Pt, slop: number): PinchTracker {
	const anchor = centroid(a, b);
	// Fingers that start on top of each other would divide by zero.
	const d0 = Math.max(gap(a, b), 1);
	let scaling = false;
	let panning = false;
	let last = anchor;
	return {
		anchor,
		update(p, q) {
			const c = centroid(p, q);
			const d = gap(p, q);
			if (!scaling && Math.abs(d - d0) > slop) scaling = true;
			if (!panning && Math.hypot(c.x - anchor.x, c.y - anchor.y) > slop) panning = true;
			let pan: PinchFrame['pan'] = null;
			if (panning) {
				pan = { dx: c.x - last.x, dy: c.y - last.y };
				last = c;
			}
			return { scale: scaling ? d / d0 : null, pan };
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

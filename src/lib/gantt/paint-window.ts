// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which part of the content the layer canvases hold (phase-2.md 8.1). Canvases are the viewport
 * plus a modest margin, and are moved with the content, so a scroll inside the window costs
 * nothing and the browser's own scrolling stays smooth; they paint again only when the view gets
 * near the window's edge. Split from layout.ts (which re-exports it) to keep that file short.
 */
import type { Rect } from './route';

/** What the canvases hold, in content coordinates. */
export type PaintWindow = Rect;

export interface WindowOptions {
	/** The most margin the window keeps beyond the view on each side, in CSS px. */
	overscanX: number;
	overscanY: number;
}

/** The margin is this share of the view, within a minimum and the caller's most. */
export const WINDOW_MARGIN = 0.2;
export const MIN_MARGIN_X = 120;
export const MIN_MARGIN_Y = 160;
/** A window moves once this share of its margin on the side it is heading for is used. */
export const WINDOW_TRIGGER = 1 / 3;
/**
 * Where a window that has just moved puts the view in the room it has: this share of the room is
 * ahead, in the direction the view was going, so that the next move is far off. The side behind
 * moves the window again only when the view has gone back by this share of a margin.
 */
export const WINDOW_LEAD = 0.75;
const BEHIND = 0.15;
/**
 * The window's top is on a multiple of this, so that a vertical move is a whole number of the
 * status line's dashes (10 px at the default token) and the overlay can keep its lines as drawn.
 */
export const WINDOW_SNAP_Y = 20;

type Dir = -1 | 0 | 1;
/** Which way each axis of a window was put (the direction the view was going), by window. */
const heading = new WeakMap<object, { x: Dir; y: Dir }>();

/**
 * One axis of `paintWindow`: whether `prev` still serves, else where the new window starts.
 * `view` and `prev` are the start and size on this axis, `extra` is the room the window adds to the
 * view, `margin` half of it and `content` the content's size.
 */
function axisOf(
	view: number,
	viewSize: number,
	prev: { at: number; size: number; dir: Dir } | null,
	size: number,
	margin: number,
	content: number,
	trigger: number,
	lead: number,
	snap: number,
): { at: number; dir: Dir; keep: boolean } {
	const put = (v: number): number =>
		Math.max(0, Math.min(content - size, Math.round(v / snap) * snap));
	const extra = size - viewSize;
	if (prev && prev.size === size) {
		const ahead = margin * (1 - trigger);
		const behind = margin * BEHIND;
		const startNeed = prev.dir > 0 ? behind : ahead;
		const endNeed = prev.dir < 0 ? behind : ahead;
		const okStart = view - prev.at >= startNeed || prev.at <= 0;
		const okEnd =
			prev.at + prev.size - (view + viewSize) >= endNeed || prev.at + prev.size >= content;
		if (okStart && okEnd) return { at: prev.at, dir: prev.dir, keep: true };
		// Heading for the end, or for the start: judged by where the view is in the window.
		const dir: Dir = view + viewSize / 2 > prev.at + prev.size / 2 ? 1 : -1;
		const room = dir > 0 ? (1 - lead) * extra : lead * extra;
		return { at: put(view - room), dir, keep: false };
	}
	return {
		at: put(view - margin),
		dir: 0,
		keep: false,
	};
}

/**
 * The window to paint for a view (the part of the content in the viewport), or `prev` while it
 * still covers the view with room to spare. A window never leaves the content, and has a fixed
 * size (the view plus a modest margin, not several times the view, or all of the content when
 * that is smaller), so the canvases only resize when the viewport does.
 *
 * It moves when a third of the margin on the side the view is heading for is used, which leaves two
 * thirds of the margin as headroom for a fling, and is then put so that most of its room is ahead of
 * the view, which makes the moves rare: a layer is painted again on each move (paint/incremental.ts).
 */
export function paintWindow(
	view: Rect,
	content: { w: number; h: number },
	o: WindowOptions,
	prev: PaintWindow | null,
): PaintWindow {
	const mx = Math.min(o.overscanX, Math.max(MIN_MARGIN_X, view.w * WINDOW_MARGIN));
	const my = Math.min(o.overscanY, Math.max(MIN_MARGIN_Y, view.h * WINDOW_MARGIN));
	const w = Math.min(content.w, Math.ceil(view.w + 2 * mx));
	const h = Math.min(content.h, Math.ceil(view.h + 2 * my));
	const was = prev ? heading.get(prev) : undefined;
	const x = axisOf(
		view.x,
		view.w,
		prev && { at: prev.x, size: prev.w, dir: was?.x ?? 0 },
		w,
		mx,
		content.w,
		WINDOW_TRIGGER,
		WINDOW_LEAD,
		1,
	);
	const y = axisOf(
		view.y,
		view.h,
		prev && { at: prev.y, size: prev.h, dir: was?.y ?? 0 },
		h,
		my,
		content.h,
		WINDOW_TRIGGER,
		WINDOW_LEAD,
		WINDOW_SNAP_Y,
	);
	if (prev && x.keep && y.keep) return prev;
	const next = { x: x.at, y: y.at, w, h };
	heading.set(next, { x: x.dir, y: y.dir });
	return next;
}

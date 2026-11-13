// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Gantt geometry (phase-2.md 6.4), shared by painting and hit testing so that what a pointer
 * hits is what was drawn. Everything is in CSS pixels in "content coordinates": x = 0 is the
 * model's `originMin`, y = 0 is the top of the first row. The header sits above, outside.
 *
 * - `GanttLayout` places bars, summary bars, milestones and link paths.
 * - `paintWindow` decides which part of the content the canvases hold. Canvases are bigger than
 *   the viewport by an overscan, and are moved with the content, so a scroll inside the window
 *   costs nothing and the browser's own scrolling stays smooth; they redraw only when the view
 *   gets near the window's edge (phase-2.md 8.1).
 */
import type { GanttLink, GanttModel, GanttRow } from './model';
import type { Theme } from './paint/theme';
import type { TimeScale } from './scale';

export interface Point {
	readonly x: number;
	readonly y: number;
}
export interface Rect {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/** Rows kept painted above and below the viewport. */
export const OVERSCAN_ROWS = 10;
/** Horizontal overscan on each side, in CSS pixels. */
export const OVERSCAN_X = 320;
/** Smallest hit areas (WCAG 2.5.8 asks for 24 px; 44 px for a coarse pointer): not styling. */
export const HIT_MIN_FINE = 24;
export const HIT_MIN_COARSE = 44;
export const LINK_SLOP_FINE = 8;
export const LINK_SLOP_COARSE = 12;

export interface Metrics {
	readonly rowHeight: number;
	readonly barHeight: number;
	readonly summaryHeight: number;
	/** Half the diagonal of a milestone diamond. */
	readonly milestoneHalf: number;
	/** The narrowest a bar is drawn, so a short task stays visible. */
	readonly minBarWidth: number;
	/** Space left of a link's first bend. */
	readonly elbow: number;
	/** Each of the two header rows. */
	readonly headerRow: number;
	/** The whole header: two rows. */
	readonly headerHeight: number;
	/** Smallest hit area. */
	readonly hitMin: number;
	/** How close to a link path a pointer must be to hit it. */
	readonly linkSlop: number;
}

/**
 * Geometry from the theme's sizes (the coarse-pointer sizes are token overrides, so `coarse` only
 * picks the hit areas, which are accessibility requirements and not styling).
 */
export function metricsFor(theme: Theme, coarse: boolean): Metrics {
	return {
		rowHeight: theme.rowHeight,
		barHeight: theme.barHeight,
		summaryHeight: theme.summaryHeight,
		milestoneHalf: theme.milestoneHalf,
		minBarWidth: theme.minBarWidth,
		elbow: theme.linkElbow,
		headerRow: theme.headerRow,
		headerHeight: theme.headerRow * 2,
		hitMin: coarse ? HIT_MIN_COARSE : HIT_MIN_FINE,
		linkSlop: coarse ? LINK_SLOP_COARSE : LINK_SLOP_FINE,
	};
}

export interface GanttLayout {
	readonly metrics: Metrics;
	readonly scale: TimeScale;
	readonly rowCount: number;
	readonly width: number;
	readonly height: number;
	rowTop(row: number): number;
	/** The row at a content y, or null above the first or below the last. */
	rowAt(y: number): number | null;
	/** The drawn bar of a row, or null when it has none (unscheduled). */
	barRect(row: number): Rect | null;
	/** What a pointer can hit: the bar grown to the minimum target size, and the row's height. */
	hitRect(row: number): Rect | null;
	/** The polyline of a link, or [] when either end has no bar. */
	linkPath(link: GanttLink): readonly Point[];
}

/** `viewWidth` keeps the content at least as wide as the viewport. */
export function createLayout(
	model: GanttModel,
	scale: TimeScale,
	metrics: Metrics,
	viewWidth = 0,
): GanttLayout {
	const rows = model.rows;
	const { rowHeight, elbow } = metrics;
	const rowTop = (row: number): number => row * rowHeight;

	const barRect = (index: number): Rect | null => {
		const r: GanttRow | undefined = rows[index];
		if (!r || r.start === null || r.end === null) return null;
		const x0 = scale.x(r.start);
		if (r.kind === 'milestone') {
			const h = metrics.milestoneHalf;
			return { x: x0 - h, y: rowTop(index) + rowHeight / 2 - h, w: 2 * h, h: 2 * h };
		}
		const w = Math.max(metrics.minBarWidth, scale.x(r.end) - x0);
		const h = r.kind === 'container' ? metrics.summaryHeight : metrics.barHeight;
		return { x: x0, y: rowTop(index) + (rowHeight - h) / 2, w, h };
	};

	const hitRect = (index: number): Rect | null => {
		const bar = barRect(index);
		if (!bar) return null;
		const w = Math.max(bar.w, metrics.hitMin);
		const h = Math.max(bar.h, Math.min(metrics.hitMin, rowHeight));
		return {
			x: bar.x - (w - bar.w) / 2,
			y: bar.y - (h - bar.h) / 2,
			w,
			h,
		};
	};

	const linkPath = (link: GanttLink): readonly Point[] => {
		const from = barRect(link.predRow);
		const to = barRect(link.succRow);
		if (!from || !to) return [];
		const x0 = from.x + from.w;
		const y0 = from.y + from.h / 2;
		const x1 = to.x;
		const y1 = to.y + to.h / 2;
		if (x1 >= x0 + elbow) {
			return [
				{ x: x0, y: y0 },
				{ x: x0 + elbow, y: y0 },
				{ x: x0 + elbow, y: y1 },
				{ x: x1, y: y1 },
			];
		}
		// The successor starts before the predecessor ends: go round through the row boundary.
		const yMid = link.succRow > link.predRow ? rowTop(link.predRow + 1) : rowTop(link.predRow);
		return [
			{ x: x0, y: y0 },
			{ x: x0 + elbow, y: y0 },
			{ x: x0 + elbow, y: yMid },
			{ x: x1 - elbow, y: yMid },
			{ x: x1 - elbow, y: y1 },
			{ x: x1, y: y1 },
		];
	};

	return {
		metrics,
		scale,
		rowCount: rows.length,
		width: Math.max(viewWidth, Math.ceil(scale.x(model.endMin))),
		height: rows.length * rowHeight,
		rowTop,
		rowAt: (y) => {
			const row = Math.floor(y / rowHeight);
			return y >= 0 && row < rows.length ? row : null;
		},
		barRect,
		hitRect,
		linkPath,
	};
}

/** The rows to paint for a vertical view, with the overscan. `last` is exclusive. */
export function rowRange(
	layout: Pick<GanttLayout, 'rowCount' | 'metrics'>,
	top: number,
	height: number,
	overscan = OVERSCAN_ROWS,
): { first: number; last: number } {
	const h = layout.metrics.rowHeight;
	const first = Math.max(0, Math.floor(top / h) - overscan);
	const last = Math.min(layout.rowCount, Math.ceil((top + height) / h) + overscan);
	return { first, last: Math.max(first, last) };
}

export function intersects(a: Rect, x: number, y: number, w: number, h: number): boolean {
	return a.x < x + w && a.x + a.w > x && a.y < y + h && a.y + a.h > y;
}

/** What the canvases hold, in content coordinates. */
export type PaintWindow = Rect;

export interface WindowOptions {
	overscanX: number;
	overscanY: number;
}

/**
 * The window to paint for a view (the part of the content in the viewport), or `prev` when it
 * still covers the view with a margin. A window never leaves the content, and has a fixed size
 * (the view plus overscan, or all of the content when that is smaller), so the canvases only
 * resize when the viewport does.
 */
export function paintWindow(
	view: Rect,
	content: { w: number; h: number },
	o: WindowOptions,
	prev: PaintWindow | null,
): PaintWindow {
	const w = Math.min(content.w, view.w + 2 * o.overscanX);
	const h = Math.min(content.h, view.h + 2 * o.overscanY);
	if (prev && prev.w === w && prev.h === h) {
		const mx = o.overscanX / 3;
		const my = o.overscanY / 3;
		const okX =
			(view.x >= prev.x + mx || prev.x <= 0) &&
			(view.x + view.w <= prev.x + prev.w - mx || prev.x + prev.w >= content.w);
		const okY =
			(view.y >= prev.y + my || prev.y <= 0) &&
			(view.y + view.h <= prev.y + prev.h - my || prev.y + prev.h >= content.h);
		if (okX && okY) return prev;
	}
	const clamp = (v: number, max: number): number => Math.max(0, Math.min(max, v));
	return {
		x: clamp(Math.round(view.x - o.overscanX), content.w - w),
		y: clamp(Math.round(view.y - o.overscanY), content.h - h),
		w,
		h,
	};
}

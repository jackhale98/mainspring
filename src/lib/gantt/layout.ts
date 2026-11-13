// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Gantt geometry (phase-2.md 6.4), shared by painting and hit testing so that what a pointer
 * hits is what was drawn. Everything is in CSS pixels in "content coordinates": x = 0 is the
 * model's `originMin`, y = 0 is the top of the first row. The header sits above, outside.
 *
 * - `GanttLayout` places bars, summary bars, milestones and link paths.
 * - `paintWindow` (paint-window.ts, re-exported here) decides which part of the content the
 *   canvases hold.
 */
import type { GanttLink, GanttModel, GanttRow } from './model';
import type { Theme } from './paint/theme';
import {
	newPath,
	pointsOf,
	routeLink,
	type MutableRect,
	type PathBuf,
	type Point,
	type Rect,
} from './route';
import { MIN_PER_DAY, createScale, type TimeScale } from './scale';

export type { Point, Rect, MutableRect } from './route';
export {
	MIN_MARGIN_X,
	MIN_MARGIN_Y,
	WINDOW_LEAD,
	WINDOW_MARGIN,
	WINDOW_SNAP_Y,
	WINDOW_TRIGGER,
	paintWindow,
	type PaintWindow,
	type WindowOptions,
} from './paint-window';

/** Rows kept painted above and below the viewport. */
export const OVERSCAN_ROWS = 10;
/** Horizontal overscan on each side, in CSS pixels. */
export const OVERSCAN_X = 200;
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
	/** Space before the first date, so a start milestone is not clipped: half a diamond and a gap. */
	readonly originPad: number;
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
		originPad: theme.milestoneHalf + theme.originGap,
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
	/**
	 * Where each row's bar is, as typed arrays (phase-2.md 6.3): `x[i]` is NaN when row `i` has no
	 * bar. Painting and hit testing read these, so a frame allocates nothing.
	 */
	readonly bars: BarArrays;
	/**
	 * Where the avatars beside each row's bar were last drawn, `[x0, x1]` per row, NaN for none.
	 * Only the painter knows (it measures text), so it reports here and hit testing reads.
	 */
	readonly avatars: Float64Array;
	rowTop(row: number): number;
	/** The row at a content y, or null above the first or below the last. */
	rowAt(y: number): number | null;
	/** Fills `out` with the drawn bar of a row; false (and `out` untouched) when it has none. */
	barInto(row: number, out: MutableRect): boolean;
	/** Fills `out` with what a pointer can hit; false when the row has no bar. */
	hitInto(row: number, out: MutableRect): boolean;
	/** Fills `out` with the polyline of a link; false when either end has no bar. */
	linkInto(link: GanttLink, out: PathBuf): boolean;
	/** The drawn bar of a row, or null when it has none (unscheduled). Allocates: not for hot paths. */
	barRect(row: number): Rect | null;
	/** What a pointer can hit: the bar grown to the minimum target size, and the row's height. */
	hitRect(row: number): Rect | null;
	/** The polyline of a link, or [] when either end has no bar. Allocates: not for hot paths. */
	linkPath(link: GanttLink): readonly Point[];
	/** The same layout with other bar positions (the reschedule tween, paint/motion.ts). */
	withBars(bars: BarArrays): GanttLayout;
}

/** Bar geometry by row, in typed arrays. `x` is NaN for a row without a bar. */
export interface BarArrays {
	readonly x: Float64Array;
	readonly y: Float64Array;
	readonly w: Float64Array;
	readonly h: Float64Array;
}

export function newBars(rows: number): BarArrays {
	return {
		x: new Float64Array(rows),
		y: new Float64Array(rows),
		w: new Float64Array(rows),
		h: new Float64Array(rows),
	};
}

/**
 * Places a bar for a row of `kind` between two minutes, with its row's top at `top`: a milestone
 * is a diamond centred on `start`, other bars have at least the minimum width.
 */
export function placeBar(
	out: MutableRect,
	kind: GanttRow['kind'],
	start: number,
	end: number,
	top: number,
	scale: TimeScale,
	m: Metrics,
): void {
	const x0 = scale.x(start);
	if (kind === 'milestone') {
		const h = m.milestoneHalf;
		out.x = x0 - h;
		out.y = top + m.rowHeight / 2 - h;
		out.w = 2 * h;
		out.h = 2 * h;
		return;
	}
	const h = kind === 'container' ? m.summaryHeight : m.barHeight;
	out.x = x0;
	out.y = top + (m.rowHeight - h) / 2;
	out.w = Math.max(m.minBarWidth, scale.x(end) - x0);
	out.h = h;
}

/** `viewWidth` keeps the content at least as wide as the viewport. */
export function createLayout(
	model: GanttModel,
	scale: TimeScale,
	metrics: Metrics,
	viewWidth = 0,
): GanttLayout {
	const rows = model.rows;
	const bars = newBars(rows.length);
	const at: MutableRect = { x: 0, y: 0, w: 0, h: 0 };
	for (let i = 0; i < rows.length; i++) {
		const r: GanttRow | undefined = rows[i];
		if (!r || r.start === null || r.end === null) {
			bars.x[i] = NaN;
			continue;
		}
		placeBar(at, r.kind, r.start, r.end, i * metrics.rowHeight, scale, metrics);
		bars.x[i] = at.x;
		bars.y[i] = at.y;
		bars.w[i] = at.w;
		bars.h[i] = at.h;
	}
	const avatars = new Float64Array(2 * rows.length).fill(NaN);
	const width = Math.max(viewWidth, Math.ceil(scale.x(model.endMin)));
	return layoutOver(model, scale, metrics, bars, avatars, width);
}

function layoutOver(
	model: GanttModel,
	scale: TimeScale,
	metrics: Metrics,
	bars: BarArrays,
	avatars: Float64Array,
	width: number,
): GanttLayout {
	const rows = model.rows;
	const { rowHeight, elbow } = metrics;
	const rowTop = (row: number): number => row * rowHeight;

	const barInto = (index: number, out: MutableRect): boolean => {
		const x = bars.x[index];
		if (x === undefined || Number.isNaN(x)) return false;
		out.x = x;
		out.y = bars.y[index] ?? 0;
		out.w = bars.w[index] ?? 0;
		out.h = bars.h[index] ?? 0;
		return true;
	};

	const hitInto = (index: number, out: MutableRect): boolean => {
		if (!barInto(index, out)) return false;
		const w = Math.max(out.w, metrics.hitMin);
		const h = Math.max(out.h, Math.min(metrics.hitMin, rowHeight));
		out.x -= (w - out.w) / 2;
		out.y -= (h - out.h) / 2;
		out.w = w;
		out.h = h;
		return true;
	};

	const pred: MutableRect = { x: 0, y: 0, w: 0, h: 0 };
	const succ: MutableRect = { x: 0, y: 0, w: 0, h: 0 };
	const linkInto = (link: GanttLink, out: PathBuf): boolean => {
		if (!barInto(link.predRow, pred) || !barInto(link.succRow, succ)) {
			out.n = 0;
			return false;
		}
		const milestone = rows[link.predRow]?.kind === 'milestone';
		routeLink(out, pred, succ, link, milestone, elbow, rowHeight);
		return true;
	};

	return {
		metrics,
		scale,
		rowCount: rows.length,
		width,
		height: rows.length * rowHeight,
		bars,
		avatars,
		rowTop,
		rowAt: (y) => {
			const row = Math.floor(y / rowHeight);
			return y >= 0 && row < rows.length ? row : null;
		},
		barInto,
		hitInto,
		linkInto,
		barRect: (index) => {
			const r: MutableRect = { x: 0, y: 0, w: 0, h: 0 };
			return barInto(index, r) ? r : null;
		},
		hitRect: (index) => {
			const r: MutableRect = { x: 0, y: 0, w: 0, h: 0 };
			return hitInto(index, r) ? r : null;
		},
		linkPath: (link) => {
			const buf = newPath();
			return linkInto(link, buf) ? pointsOf(buf) : [];
		},
		withBars: (b) => layoutOver(model, scale, metrics, b, avatars, width),
	};
}

/**
 * The vertical scroll offset that shows row `index` below the sticky header: the offset as it is
 * when the row is in view, else the nearest one that shows the whole row.
 */
export function revealTop(index: number, rowHeight: number, top: number, viewH: number): number {
	const y = index * rowHeight;
	if (y < top) return y;
	return y + rowHeight > top + viewH ? y + rowHeight - viewH : top;
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

/** The time scale of a zoom for a model: its first date sits `originPad` pixels from the left. */
export function scaleFor(model: GanttModel, pxPerDay: number, metrics: Metrics): TimeScale {
	const pxPerMin = pxPerDay / MIN_PER_DAY;
	return createScale(pxPerDay, model.originMin - metrics.originPad / pxPerMin);
}

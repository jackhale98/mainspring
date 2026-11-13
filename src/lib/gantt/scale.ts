// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's time scale and zoom (phase-2.md 6.4): a linear map between integer minutes since
 * the project start and CSS pixels, and the four named zoom levels from day to quarter with
 * continuous zoom between them.
 *
 * Zoom is stored as pixels per calendar day, the unit people reason in; the scale itself works
 * in pixels per minute. Nothing here reads the schedule: it is geometry only.
 */
import type { Minutes } from '../../engine/protocol';

export const MIN_PER_DAY = 1440;

export type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';

/** The pixels per day each named level snaps to. A day is 56 px wide, a week 112, and so on. */
export const ZOOM_PRESETS: Readonly<Record<ZoomLevel, number>> = {
	day: 56,
	week: 16,
	month: 4.5,
	quarter: 1.2,
};
export const ZOOM_ORDER: readonly ZoomLevel[] = ['day', 'week', 'month', 'quarter'];

export const MIN_PX_PER_DAY = 0.8;
export const MAX_PX_PER_DAY = 96;
export const DEFAULT_ZOOM: ZoomLevel = 'week';

export interface TimeScale {
	readonly pxPerMin: number;
	/** The minute drawn at x = 0. */
	readonly originMin: Minutes;
	x(m: Minutes): number;
	m(x: number): Minutes;
}

export function createScale(pxPerDay: number, originMin: Minutes = 0): TimeScale {
	const pxPerMin = pxPerDay / MIN_PER_DAY;
	return {
		pxPerMin,
		originMin,
		x: (m) => (m - originMin) * pxPerMin,
		m: (x) => x / pxPerMin + originMin,
	};
}

export function clampZoom(pxPerDay: number): number {
	return Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, pxPerDay));
}

/** The named level whose preset is nearest (on a log scale) to a zoom. */
export function nearestLevel(pxPerDay: number): ZoomLevel {
	let best: ZoomLevel = 'day';
	let bestGap = Infinity;
	for (const level of ZOOM_ORDER) {
		const gap = Math.abs(Math.log(pxPerDay / ZOOM_PRESETS[level]));
		if (gap < bestGap) {
			best = level;
			bestGap = gap;
		}
	}
	return best;
}

/** One level in: the next finer preset that is clearly more zoomed in than `pxPerDay`. */
export function zoomIn(pxPerDay: number): number {
	for (let i = ZOOM_ORDER.length - 1; i >= 0; i--) {
		const px = ZOOM_PRESETS[ZOOM_ORDER[i] as ZoomLevel];
		if (px > pxPerDay * 1.05) return px;
	}
	return clampZoom(pxPerDay);
}

/** One level out: the next coarser preset that is clearly more zoomed out. */
export function zoomOut(pxPerDay: number): number {
	for (const level of ZOOM_ORDER) {
		const px = ZOOM_PRESETS[level];
		if (px < pxPerDay / 1.05) return px;
	}
	return clampZoom(pxPerDay);
}

export function canZoomIn(pxPerDay: number): boolean {
	return zoomIn(pxPerDay) > pxPerDay * 1.05;
}
export function canZoomOut(pxPerDay: number): boolean {
	return zoomOut(pxPerDay) < pxPerDay / 1.05;
}

/**
 * The scroll offset that keeps `anchorMin` under the same viewport x after the zoom changes to
 * `to`. `anchorX` is the anchor's distance from the left edge of the viewport.
 */
export function scrollAfterZoom(to: TimeScale, anchorMin: Minutes, anchorX: number): number {
	return Math.max(0, to.x(anchorMin) - anchorX);
}

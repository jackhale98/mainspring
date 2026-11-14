// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The handles of the selected bar (phase-2.md 7.1, 10.3; ADR-0008 #4): the size handle on the
 * task's free edge, the link dot beside its end and the progress knob on its foot. One module for
 * the geometry, so that the overlay draws a handle where the hit test finds it: the zones here are
 * the hit areas (at least 24 px, 44 px for a coarse pointer), and what is drawn sits inside them.
 *
 * - The size handle is on the END edge of an ASAP task and the START edge of an ALAP one
 *   (`resizeEdge` of intents.ts). Its zone straddles the edge: mostly inside the bar.
 * - The link dot is outside the end of the bar, so it never competes with the size handle, which
 *   is drawn inside. A task with a handle on its right edge has both; they sit in zones side by side.
 * - The progress knob sits on the bar's foot at the completed share. Its zone is the lower part of
 *   the bar and what is below it, so the upper part of the same x still belongs to the size handle.
 * - A task written with macros (`textOnly`), a task with no dates and a container's size and
 *   progress have no handle. A milestone and a container keep the link dot.
 *
 * Nothing here allocates on the hit path (`handleAt` reads a bar into the caller's scratch rect).
 */
import type { GanttLayout, Metrics, MutableRect } from './layout';
import type { GanttRow } from './model';

export type HandlePart = 'end-handle' | 'link-dot' | 'progress';

export interface HandleSet {
	/** The edge the size handle is on, or null for none. */
	readonly resize: 'start' | 'end' | null;
	readonly link: boolean;
	/** The percent complete the knob sits at, or null for no progress handle. */
	readonly progress: number | null;
}

export const NO_HANDLES: HandleSet = { resize: null, link: false, progress: null };

/** A zone that reaches inside the bar from its edge, as a share of the minimum target. */
const INSIDE = 0.7;
const OUTSIDE = 0.1;
/** How much of the zone's height is under the bar's foot for the knob (the rest is above it). */
const KNOB_ABOVE = 0.35;
const KNOB_BELOW = 0.65;

export function clampPercent(p: number | null): number {
	return Math.min(100, Math.max(0, Number.isFinite(p ?? NaN) ? (p as number) : 0));
}

/**
 * The handles of a row. `edge` is `resizeEdge(task, ctx)`: null for a milestone, a container, a
 * text-only or an unscheduled task. The knob is for leaves only (R9).
 */
export function handlesOf(row: GanttRow | undefined, edge: 'start' | 'end' | null): HandleSet {
	if (!row || row.textOnly !== null || !row.scheduled || row.start === null || row.end === null) {
		return NO_HANDLES;
	}
	return {
		resize: row.kind === 'task' ? edge : null,
		link: true,
		progress: row.kind === 'task' ? clampPercent(row.complete) : null,
	};
}

/** Whether a set has anything to grab. */
export const hasHandles = (s: HandleSet): boolean =>
	s.resize !== null || s.link || s.progress !== null;

/** The centre of the link dot of a bar, and the drawn size is the theme's. */
export function dotCentre(bar: MutableRect, m: Metrics): { x: number; y: number } {
	return { x: bar.x + bar.w + (OUTSIDE + 0.5) * m.hitMin, y: bar.y + bar.h / 2 };
}

/** The centre of the progress knob: on the bar's foot at the completed share. */
export function knobCentre(bar: MutableRect, percent: number): { x: number; y: number } {
	return { x: bar.x + (bar.w * clampPercent(percent)) / 100, y: bar.y + bar.h };
}

/**
 * The x range of the size handle's zone: across the free edge, mostly inside the bar. On a short
 * bar it takes no more than 40 % of the bar (at least a third of the target), so that the body is
 * still there to press and move; the rest of the target is outside the bar, beside the link dot.
 */
export function resizeSpan(bar: MutableRect, edge: 'start' | 'end', m: Metrics): [number, number] {
	const h = m.hitMin;
	const inside = Math.min(INSIDE * h, Math.max(0.4 * bar.w, 0.3 * h));
	return edge === 'end'
		? [bar.x + bar.w - inside, bar.x + bar.w + OUTSIDE * h]
		: [bar.x - OUTSIDE * h, bar.x + inside];
}

const scratch: MutableRect = { x: 0, y: 0, w: 0, h: 0 };

/**
 * Which handle of the selected bar is at a content point, or null. The order settles overlaps:
 * the link dot, then the knob (its lower zone), then the size handle.
 */
export function handleAt(
	layout: GanttLayout,
	row: number,
	set: HandleSet,
	x: number,
	y: number,
): HandlePart | null {
	if (!hasHandles(set) || !layout.barInto(row, scratch)) return null;
	const m = layout.metrics;
	const h = m.hitMin;
	const bar = scratch;
	const cy = bar.y + bar.h / 2;
	if (set.link) {
		const left = bar.x + bar.w + OUTSIDE * h;
		if (x >= left && x <= left + h && Math.abs(y - cy) <= h / 2) return 'link-dot';
	}
	if (set.progress !== null) {
		const k = knobCentre(bar, set.progress);
		// The knob's zone reaches up no further than the middle of the bar: its upper half stays
		// the body's, and a handle on the bar's own edge keeps its place.
		const top = Math.max(k.y - KNOB_ABOVE * h, cy);
		if (Math.abs(x - k.x) <= h / 2 && y >= top && y <= k.y + KNOB_BELOW * h) return 'progress';
	}
	if (set.resize !== null) {
		const [x0, x1] = resizeSpan(bar, set.resize, m);
		if (x >= x0 && x <= x1 && Math.abs(y - cy) <= h / 2) return 'end-handle';
	}
	return null;
}

/** The share of the bar a pointer x is at, as a percent in 0..100 (not snapped). */
export function percentAt(bar: MutableRect, x: number): number {
	return bar.w <= 0 ? 0 : clampPercent(((x - bar.x) / bar.w) * 100);
}

/** Progress snaps to 5 % (R9). */
export const snapPercent = (p: number): number => Math.round(clampPercent(p) / 5) * 5;

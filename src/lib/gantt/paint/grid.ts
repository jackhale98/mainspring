// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The grid layer, the bottom canvas (phase-2.md 8.1): the surface, row separators and the
 * vertical lines at the header's cell edges. It redraws only when the painted window moves, on
 * zoom, and when the model or the colours change. The today and status-date lines are not here:
 * they follow the clock, so they are on the overlay layer (markers.ts). `markerLines` stays here
 * because the header draws the same lines' crowns from it.
 */
import type { Minutes } from '../../../engine/protocol';
import type { GanttModel } from '../model';
import { rowRange, type Rect } from '../layout';
import type { TickRows } from '../ticks';
import { snap, type PaintFrame } from './canvas';
import { layerFor } from './incremental';

export type MarkerKind = 'today' | 'status' | 'both';
export interface Marker {
	readonly at: number;
	readonly kind: MarkerKind;
}

/** Two lines closer than this are drawn as one. */
const MERGE_WITHIN_MIN = 60;

/**
 * The marker lines for a model. `today` is the wall-clock minute from outside the model (the
 * clock is not part of what the model is built from); it defaults to the model's own.
 */
export function markerLines(model: GanttModel, today: Minutes | null): Marker[] {
	const status = model.statusMin;
	if (today !== null && status !== null && Math.abs(today - status) <= MERGE_WITHIN_MIN) {
		return [{ at: status, kind: 'both' }];
	}
	const out: Marker[] = [];
	if (status !== null) out.push({ at: status, kind: 'status' });
	if (today !== null) out.push({ at: today, kind: 'today' });
	return out;
}

interface GridFrame extends PaintFrame {
	readonly ticks: TickRows | null;
	readonly selectedRow: number | null;
}

/** Paints the part of the grid that touches `area` (clipped and cleared by the layer). */
function drawGrid(f: GridFrame, area: Rect): void {
	const { ctx, dpr, layout, theme, ticks, selectedRow } = f;
	ctx.fillStyle = theme.surface;
	ctx.fillRect(area.x, area.y, area.w, area.h);

	const hairline = 1 / dpr;
	const { first, last } = rowRange(layout, area.y, area.h, 0);
	// The selected row sits under the bars, so a pale tint never hides one.
	if (selectedRow !== null && selectedRow >= first && selectedRow < last) {
		ctx.fillStyle = theme.rowSelected;
		ctx.fillRect(area.x, layout.rowTop(selectedRow), area.w, layout.metrics.rowHeight);
	}
	// Row separators are a token away (width 0 draws none).
	if (theme.rowLineWidth > 0) {
		ctx.fillStyle = theme.rowLine;
		for (let r = first; r < last; r++) {
			ctx.fillRect(
				area.x,
				snap(layout.rowTop(r + 1), dpr) - theme.rowLineWidth,
				area.w,
				theme.rowLineWidth,
			);
		}
	}

	const { scale } = layout;
	const left = area.x - 1;
	const right = area.x + area.w + 1;
	if (ticks) {
		ctx.fillStyle = theme.gridMinor;
		for (const t of ticks.minor) {
			const x = scale.x(t.at);
			if (x >= left && x <= right) ctx.fillRect(snap(x, dpr), area.y, hairline, area.h);
		}
		ctx.fillStyle = theme.gridMajor;
		for (const t of ticks.major) {
			const x = scale.x(t.at);
			if (x >= left && x <= right) ctx.fillRect(snap(x, dpr), area.y, hairline, area.h);
		}
	}
}

/** The row selected when each grid canvas was last painted, to repaint only what changed. */
const selectedBefore = new WeakMap<object, number | null>();

/**
 * Paints the grid for a window. What it draws is the surface and the tick lines, which run the
 * full height, and the selected row's tint: so a vertical move of the window moves nothing but the
 * canvas, and only the tint is erased and drawn again; a horizontal move, or a new model, scale or
 * theme, paints it all (nothing is copied, see incremental.ts). `ticks` covers the window, so a strip gets its lines from the ticks of the
 * frame it was exposed in.
 */
export function paintGrid(
	f: PaintFrame,
	ticks: TickRows | null,
	selectedRow: number | null = null,
): void {
	const frame: GridFrame = { ...f, ticks, selectedRow };
	const layer = layerFor<GridFrame>(f.ctx, 'grid', drawGrid);
	const before = selectedBefore.get(f.ctx);
	const old = layer.window;
	selectedBefore.set(f.ctx, selectedRow);
	const dirty: Rect[] = [];
	const h = f.layout.metrics.rowHeight;
	const moved = old !== null && (old.x !== f.win.x || old.y !== f.win.y);
	if (old !== null && before !== undefined && (before !== selectedRow || moved)) {
		// Where the old tint is on the canvas, in the new window's coordinates.
		if (before !== null)
			dirty.push({ x: f.win.x, y: f.layout.rowTop(before) - old.y + f.win.y, w: f.win.w, h });
		if (selectedRow !== null)
			dirty.push({ x: f.win.x, y: f.layout.rowTop(selectedRow), w: f.win.w, h });
	}
	// What else the grid draws: the ticks' level decides the lines; separators depend on y.
	layer.paint(frame, [f.layout, f.theme, f.dpr, ticks?.level ?? null], {
		dirty,
		invariantY: f.theme.rowLineWidth === 0,
	});
}

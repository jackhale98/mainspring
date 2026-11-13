// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The grid layer, the bottom canvas (phase-2.md 8.1): the surface, row separators, the vertical
 * lines at the header's cell edges, and the today and status-date lines. It redraws only when
 * the painted window moves, on zoom, and when the model or the colours change.
 *
 * The lines differ in more than colour (WCAG 1.4.1): today is solid, the status date is dashed.
 * When the two fall within an hour, as they do for a plan without `now` (phase-2.md 19.17), one
 * solid line is drawn and called "Today (status date)".
 */
import type { GanttModel } from '../model';
import { rowRange } from '../layout';
import type { TickRows } from '../ticks';
import { begin, snap, type PaintFrame } from './canvas';

export type MarkerKind = 'today' | 'status' | 'both';
export interface Marker {
	readonly at: number;
	readonly kind: MarkerKind;
}

/** Two lines closer than this are drawn as one. */
const MERGE_WITHIN_MIN = 60;

export function markerLines(model: GanttModel): Marker[] {
	const { todayMin: today, statusMin: status } = model;
	if (today !== null && status !== null && Math.abs(today - status) <= MERGE_WITHIN_MIN) {
		return [{ at: status, kind: 'both' }];
	}
	const out: Marker[] = [];
	if (status !== null) out.push({ at: status, kind: 'status' });
	if (today !== null) out.push({ at: today, kind: 'today' });
	return out;
}

export function paintGrid(
	f: PaintFrame,
	ticks: TickRows | null,
	selectedRow: number | null = null,
): void {
	const { ctx, win, dpr, layout, model, theme } = f;
	begin(ctx, win, dpr);
	ctx.fillStyle = theme.surface;
	ctx.fillRect(win.x, win.y, win.w, win.h);

	const hairline = 1 / dpr;
	const { first, last } = rowRange(layout, win.y, win.h, 0);
	// The selected row sits under the bars, so a pale tint never hides one.
	if (selectedRow !== null && selectedRow >= first && selectedRow < last) {
		ctx.fillStyle = theme.rowSelected;
		ctx.fillRect(win.x, layout.rowTop(selectedRow), win.w, layout.metrics.rowHeight);
	}
	// Row separators are a token away (width 0 draws none).
	if (theme.rowLineWidth > 0) {
		ctx.fillStyle = theme.rowLine;
		for (let r = first; r < last; r++) {
			ctx.fillRect(
				win.x,
				snap(layout.rowTop(r + 1), dpr) - theme.rowLineWidth,
				win.w,
				theme.rowLineWidth,
			);
		}
	}

	const { scale } = layout;
	const left = win.x - 1;
	const right = win.x + win.w + 1;
	if (ticks) {
		ctx.fillStyle = theme.gridMinor;
		for (const t of ticks.minor) {
			const x = scale.x(t.at);
			if (x >= left && x <= right) ctx.fillRect(snap(x, dpr), win.y, hairline, win.h);
		}
		ctx.fillStyle = theme.gridMajor;
		for (const t of ticks.major) {
			const x = scale.x(t.at);
			if (x >= left && x <= right) ctx.fillRect(snap(x, dpr), win.y, hairline, win.h);
		}
	}

	for (const m of markerLines(model)) {
		const x = scale.x(m.at);
		const width = theme.markerWidth;
		if (x < left - width || x > right + width) continue;
		ctx.fillStyle = m.kind === 'status' ? theme.statusDate : theme.today;
		const x0 = snap(x - width / 2, dpr);
		if (m.kind === 'status') {
			// Dashed: 1.5 dashes on, 1 off.
			const on = theme.dash * 1.5;
			const step = theme.dash * 2.5;
			for (let y = win.y - (win.y % step); y < win.y + win.h; y += step) {
				ctx.fillRect(x0, y, width, on);
			}
		} else {
			ctx.fillRect(x0, win.y, width, win.h);
		}
	}
}

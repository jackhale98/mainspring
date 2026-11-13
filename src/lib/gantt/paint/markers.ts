// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The today and status-date lines, drawn on the overlay layer (phase-2.md 6.3 and 8.1): they are
 * the only part of the picture that depends on the clock, so they live on the layer that redraws
 * cheaply and a tick of the clock never repaints the grid or the bars, nor rebuilds the model.
 *
 * The lines differ in more than colour (WCAG 1.4.1): today is solid, the status date is dashed.
 * When the two fall within an hour, as they do for a plan without `now` (phase-2.md 19.17), one
 * solid line is drawn.
 *
 * A line leaves a gap where it would cross a task's name, so that the text stays readable in both
 * themes: the names are on the layer below (the bars), so the line is the one that gives way. The
 * runs come from the layout (`labels`), which knows them before the bars are painted.
 */
import type { Minutes } from '../../../engine/protocol';
import { snap, type PaintFrame } from './canvas';
import { LABEL_STRIDE } from '../labels';
import { markerLines } from './grid';

/** Clear space left round a name, along the line, in px. */
const NAME_PAD = 3;

/** Clears the line's width at (x0, win rows) wherever it crosses a name; whether it cleared any. */
function cutNames(f: PaintFrame, x0: number, width: number): boolean {
	const { ctx, win, layout, theme } = f;
	const { labels, metrics } = layout;
	if (labels.length === 0) return false;
	const rowH = metrics.rowHeight;
	const first = Math.max(0, Math.floor(win.y / rowH));
	const last = Math.min(layout.rowCount, Math.ceil((win.y + win.h) / rowH));
	const half = Math.max(theme.fontSize, theme.labelSize, theme.displaySize) / 2 + 2;
	const at = x0 + width / 2;
	let any = false;
	for (let r = first; r < last; r++) {
		const a = labels[LABEL_STRIDE * r];
		const b = labels[LABEL_STRIDE * r + 1];
		if (a === undefined || b === undefined || Number.isNaN(a)) continue;
		if (at < a - NAME_PAD || at > b + NAME_PAD) continue;
		ctx.clearRect(x0 - 1, r * rowH + rowH / 2 - half, width + 2, 2 * half);
		any = true;
	}
	return any;
}

/**
 * `note` is told each rectangle drawn on, so that the overlay can erase just those. Returns
 * whether a line was cut at a name (the picture then depends on the rows in the window).
 */
export function paintMarkers(
	f: PaintFrame,
	todayMin: Minutes | null,
	note?: (x: number, y: number, w: number, h: number) => void,
): boolean {
	const { ctx, win, dpr, layout, model, theme } = f;
	const { scale } = layout;
	let cut = false;
	const left = win.x - 1;
	const right = win.x + win.w + 1;
	for (const m of markerLines(model, todayMin)) {
		const x = scale.x(m.at);
		const width = theme.markerWidth;
		if (x < left - width || x > right + width) continue;
		ctx.fillStyle = m.kind === 'status' ? theme.statusDate : theme.today;
		const x0 = snap(x - width / 2, dpr);
		note?.(x0, win.y, width, win.h);
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
		if (cutNames(f, x0, width)) cut = true;
	}
	return cut;
}

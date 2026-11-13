// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The today and status-date lines, drawn on the overlay layer (phase-2.md 6.3 and 8.1): they are
 * the only part of the picture that depends on the clock, so they live on the layer that redraws
 * cheaply and a tick of the clock never repaints the grid or the bars, nor rebuilds the model.
 *
 * The lines differ in more than colour (WCAG 1.4.1): today is solid, the status date is dashed.
 * When the two fall within an hour, as they do for a plan without `now` (phase-2.md 19.17), one
 * solid line is drawn.
 */
import type { Minutes } from '../../../engine/protocol';
import { snap, type PaintFrame } from './canvas';
import { markerLines } from './grid';

export function paintMarkers(f: PaintFrame, todayMin: Minutes | null): void {
	const { ctx, win, dpr, layout, model, theme } = f;
	const { scale } = layout;
	const left = win.x - 1;
	const right = win.x + win.w + 1;
	for (const m of markerLines(model, todayMin)) {
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

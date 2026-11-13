// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The overlay layer, the top canvas and the one pointers land on (phase-2.md 8.1): the selected
 * row and its bar, the hovered row, a hovered link. It is the only layer that redraws on
 * hover or selection, so those never touch the bars. The drag ghost, link rubber band and drop
 * indicator of the gesture task (T16) join it here.
 */
import { rowRange, type GanttLayout, type Point } from '../layout';
import type { GanttModel } from '../model';
import { begin, roundedRect, type PaintFrame } from './canvas';

export interface OverlayState {
	readonly selectedRow: number | null;
	readonly hoverRow: number | null;
	readonly hoverLink: number | null;
}

export const NO_OVERLAY: OverlayState = { selectedRow: null, hoverRow: null, hoverLink: null };

function band(f: PaintFrame, row: number, colour: string, alpha: number): void {
	const { ctx, win, layout } = f;
	ctx.globalAlpha = alpha;
	ctx.fillStyle = colour;
	ctx.fillRect(win.x, layout.rowTop(row), win.w, layout.metrics.rowHeight);
	ctx.globalAlpha = 1;
}

function ringAround(f: PaintFrame, row: number): void {
	const { ctx, layout, model, theme } = f;
	const bar = layout.barRect(row);
	if (!bar) return;
	const kind = model.rows[row]?.kind;
	ctx.lineWidth = theme.ringWidth;
	ctx.strokeStyle = theme.focus;
	if (kind === 'milestone') {
		const cx = bar.x + bar.w / 2;
		const cy = bar.y + bar.h / 2;
		const r = bar.w / 2 + theme.ringGap + 1;
		ctx.beginPath();
		ctx.moveTo(cx, cy - r);
		ctx.lineTo(cx + r, cy);
		ctx.lineTo(cx, cy + r);
		ctx.lineTo(cx - r, cy);
		ctx.closePath();
		ctx.stroke();
		return;
	}
	roundedRect(
		ctx,
		bar.x - theme.ringGap,
		bar.y - theme.ringGap,
		bar.w + 2 * theme.ringGap,
		bar.h + 2 * theme.ringGap,
		theme.barRadius + (kind === 'container' ? 0 : theme.ringGap),
	);
	ctx.stroke();
}

export function linkPathOf(
	layout: GanttLayout,
	model: GanttModel,
	index: number,
): readonly Point[] {
	const link = model.links[index];
	return link ? layout.linkPath(link) : [];
}

export function paintOverlay(f: PaintFrame, state: OverlayState): void {
	const { ctx, win, dpr, layout, model, theme } = f;
	begin(ctx, win, dpr);
	const { first, last } = rowRange(layout, win.y, win.h, 0);
	const inRange = (r: number | null): r is number => r !== null && r >= first && r < last;

	if (inRange(state.hoverRow) && state.hoverRow !== state.selectedRow) {
		band(f, state.hoverRow, theme.rowHover, theme.hoverOpacity);
	}
	if (inRange(state.selectedRow)) {
		ringAround(f, state.selectedRow);
	}
	if (state.hoverLink !== null) {
		const path = linkPathOf(layout, model, state.hoverLink);
		if (path.length > 1) {
			ctx.strokeStyle = theme.accent;
			ctx.lineWidth = theme.linkWidthHover;
			ctx.lineJoin = 'round';
			ctx.beginPath();
			path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
			ctx.stroke();
		}
	}
}

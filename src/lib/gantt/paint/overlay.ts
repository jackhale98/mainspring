// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The overlay layer, the top canvas and the one pointers land on (phase-2.md 8.1): a ring round
 * the selected bar, a thinner outline round the hovered one, a hovered link. Outlines only: a
 * filled band over the bars would veil them (the selected row's tint is on the grid layer, under
 * the bars). It is the only layer that redraws on hover, so hover never touches the bars. The drag ghost, link rubber band and drop
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

/** An outline `gap` pixels outside a row's bar, in the bar's own shape. */
function outlineAround(
	f: PaintFrame,
	row: number,
	colour: string,
	width: number,
	gap: number,
): void {
	const { ctx, layout, model, theme } = f;
	const bar = layout.barRect(row);
	if (!bar) return;
	const kind = model.rows[row]?.kind;
	ctx.lineWidth = width;
	ctx.strokeStyle = colour;
	if (kind === 'milestone') {
		const cx = bar.x + bar.w / 2;
		const cy = bar.y + bar.h / 2;
		const r = bar.w / 2 + gap + 1;
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
		bar.x - gap,
		bar.y - gap,
		bar.w + 2 * gap,
		bar.h + 2 * gap,
		Math.min(theme.barRadius, bar.w / 3) + (kind === 'container' ? 0 : gap),
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
		outlineAround(f, state.hoverRow, theme.borderStrong, theme.hoverRingWidth, 1);
	}
	if (inRange(state.selectedRow)) {
		outlineAround(f, state.selectedRow, theme.focus, theme.ringWidth, theme.ringGap);
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

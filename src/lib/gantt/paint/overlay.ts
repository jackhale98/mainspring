// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The overlay layer, the top canvas and the one pointers land on (phase-2.md 8.1): the today and
 * status-date lines (they follow the clock, so they are on the layer that is cheap to redraw), a
 * ring round the selected bar, a thinner outline round the hovered one, a hovered link. Outlines
 * only: a filled band over the bars would veil them (the selected row's tint is on the grid layer,
 * under the bars). It is the only layer that redraws on hover, so hover never touches the bars.
 * The drag ghost, link rubber band and drop indicator of the gesture task (T16) join it here.
 */
import type { Minutes } from '../../../engine/protocol';
import { rowRange, type GanttLayout, type MutableRect, type Point } from '../layout';
import type { GanttModel } from '../model';
import { roundedRect, toContent, type PaintFrame } from './canvas';
import { routeShortened, traceLink } from './links';
import { paintMarkers } from './markers';

export interface OverlayState {
	readonly selectedRow: number | null;
	readonly hoverRow: number | null;
	readonly hoverLink: number | null;
	/** The wall-clock minute for the today line (`todayOf`); the clock is not in the model. */
	readonly todayMin?: Minutes | null;
}

export const NO_OVERLAY: OverlayState = { selectedRow: null, hoverRow: null, hoverLink: null };

const bar: MutableRect = { x: 0, y: 0, w: 0, h: 0 };

/**
 * What the overlay drew last, as rectangles in the canvas's own pixels (x, y, w, h each, in CSS px
 * from the canvas corner), so that the next paint erases only those and not the whole canvas: the
 * overlay is sparse, and clearing several megapixels for a hover or a window move cost more than
 * drawing a ring.
 */
interface Drawn {
	size: string;
	rects: number[];
	/** What it was drawn for, to tell a vertical move of the window from a change. */
	what: readonly unknown[];
	x: number;
	y: number;
	/** Whether anything but the full-height marker lines was drawn. */
	rings: boolean;
}
const drawn = new WeakMap<object, Drawn>();
let current: number[] = [];

/** Notes a rectangle in content coordinates as drawn on, for the next erase. */
function note(f: PaintFrame, x: number, y: number, w: number, h: number): void {
	current.push(x - f.win.x, y - f.win.y, w, h);
}

function erase(f: PaintFrame, what: readonly unknown[]): void {
	const { ctx, dpr } = f;
	const canvas = ctx.canvas;
	const size = `${canvas.width}x${canvas.height}@${dpr}`;
	const prev = drawn.get(ctx);
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	if (!prev || prev.size !== size) {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	} else {
		for (let i = 0; i < prev.rects.length; i += 4) {
			const x = Math.floor((prev.rects[i] ?? 0) * dpr) - 2;
			const y = Math.floor((prev.rects[i + 1] ?? 0) * dpr) - 2;
			const w = Math.ceil((prev.rects[i + 2] ?? 0) * dpr) + 4;
			const h = Math.ceil((prev.rects[i + 3] ?? 0) * dpr) + 4;
			ctx.clearRect(x, y, w, h);
		}
	}
	current = [];
	drawn.set(ctx, { size, rects: current, what, x: f.win.x, y: f.win.y, rings: false });
	toContent(ctx, f.win, dpr);
}

/** An outline `gap` pixels outside a row's bar, in the bar's own shape. */
function outlineAround(
	f: PaintFrame,
	row: number,
	colour: string,
	width: number,
	gap: number,
): void {
	const { ctx, layout, model, theme } = f;
	if (!layout.barInto(row, bar)) return;
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
		note(f, cx - r - width, cy - r - width, 2 * (r + width), 2 * (r + width));
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
	const pad = gap + width;
	note(f, bar.x - pad, bar.y - pad, bar.w + 2 * pad, bar.h + 2 * pad);
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
	const { ctx, win, layout, model, theme } = f;
	const { first, last } = rowRange(layout, win.y, win.h, 0);
	const inRange = (r: number | null): r is number => r !== null && r >= first && r < last;
	const link = state.hoverLink === null ? undefined : model.links[state.hoverLink];
	const linkInRange =
		link !== undefined &&
		Math.max(link.predRow, link.succRow) >= first &&
		Math.min(link.predRow, link.succRow) < last;
	const rings = inRange(state.selectedRow) || inRange(state.hoverRow) || linkInRange;
	const today = state.todayMin ?? null;
	const what = [model, layout, theme, state.selectedRow, state.hoverRow, state.hoverLink, today];

	// A move of the window up or down, with nothing else changed: the marker lines run the full
	// height of the canvas and are still where they were on it, so unless a ring was drawn (it
	// would be in the wrong place) or one comes into the window, the canvas is not touched at all.
	// Touching a canvas costs its whole size when it is handed to the compositor.
	const before = drawn.get(ctx);
	if (
		before &&
		!before.rings &&
		!rings &&
		before.x === win.x &&
		before.y !== win.y &&
		// The status line's dashes sit on multiples of their step: only a move of whole steps keeps them.
		Math.abs(
			(win.y - before.y) / (theme.dash * 2.5) - Math.round((win.y - before.y) / (theme.dash * 2.5)),
		) < 1e-6 &&
		before.size === `${ctx.canvas.width}x${ctx.canvas.height}@${f.dpr}` &&
		before.what.length === what.length &&
		before.what.every((v, i) => v === what[i])
	) {
		before.y = win.y;
		return;
	}
	erase(f, what);

	paintMarkers(f, today, (x, y, w, h) => note(f, x, y, w, h));

	if (inRange(state.hoverRow) && state.hoverRow !== state.selectedRow) {
		outlineAround(f, state.hoverRow, theme.borderStrong, theme.hoverRingWidth, 1);
	}
	if (inRange(state.selectedRow)) {
		outlineAround(f, state.selectedRow, theme.focus, theme.ringWidth, theme.ringGap);
	}
	const hovered = link;
	if (hovered) {
		// On the very path the base layer drew: shortened by the link gap, rounded corners, and its
		// arrow head, only thicker and in the accent.
		const path = routeShortened(layout, hovered, theme);
		if (path && path.n > 1) {
			ctx.strokeStyle = theme.accent;
			ctx.lineWidth = theme.linkWidthHover;
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';
			ctx.beginPath();
			traceLink(ctx, path, theme);
			ctx.stroke();
			let x0 = Infinity;
			let y0 = Infinity;
			let x1 = -Infinity;
			let y1 = -Infinity;
			for (let i = 0; i < path.n; i++) {
				const x = path.xy[2 * i] ?? 0;
				const y = path.xy[2 * i + 1] ?? 0;
				x0 = Math.min(x0, x);
				y0 = Math.min(y0, y);
				x1 = Math.max(x1, x);
				y1 = Math.max(y1, y);
			}
			const pad = theme.linkWidthHover + theme.arrowSize + 2;
			note(f, x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
		}
	}
}

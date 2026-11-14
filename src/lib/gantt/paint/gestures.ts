// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the overlay draws for the gestures (phase-2.md 7.1, 7.3, 8.1; ADR-0007), apart from the
 * rings, which are overlay.ts's: the handles of the selected bar, the preview of a dragged bar,
 * the pending bar that stays after the drop until the engine answers, the rubber band of a link
 * and its target, and the label that says what a drop would do. It all sits on the overlay, the
 * layer that is cheap to redraw, so a pointer move never repaints the bars.
 *
 * - A **preview** is the simple estimate of where the bar goes (preview.ts): a translucent bar in
 *   the pending colour with a dashed outline, beside the real bar, which stays where the schedule
 *   has it until the engine answers. A **pending** bar (applied, not yet scheduled) is the same
 *   place with a hatched fill. A bar that **does not schedule** is the real bar with a dashed
 *   outline in the critical colour and its words. None of them is a schedule.
 * - The handles are the zones of handles.ts, drawn inside them: a grip on the size handle's edge,
 *   a dot beside the end, a knob on the foot.
 * - Everything is drawn in content coordinates through the frame's transform, and every rectangle
 *   is reported to the overlay's `note`, so that the next paint erases only those.
 */
import { dotCentre, knobCentre, resizeSpan, type HandleSet } from '../handles';
import { placeBar, type MutableRect } from '../layout';
import type { Ghost } from '../preview';
import { roundedRect, textWidth, type PaintFrame } from './canvas';

/** A link being made: from the bar's dot to the pointer or to a bar, with the verdict. */
export interface Band {
	readonly fromRow: number;
	/** The pointer, in content coordinates; null in a keyboard link mode, which has a target. */
	readonly x: number | null;
	readonly y: number | null;
}

export interface LinkTarget {
	readonly row: number;
	readonly ok: boolean;
}

export interface GestureLabel {
	readonly text: string;
	/** Where it hangs from, in content coordinates, and whether it says the drop is refused. */
	readonly x: number;
	readonly y: number;
	readonly blocked: boolean;
	/**
	 * The content x range a person can see (the painted window is wider than the view, and the
	 * label must not hang where it is cut off); the painted window without one.
	 */
	readonly within?: { readonly left: number; readonly right: number };
}

/** Everything the overlay draws for gestures; null fields draw nothing. */
export interface GestureOverlay {
	readonly handles: HandleSet | null;
	readonly ghosts: readonly Ghost[];
	readonly band: Band | null;
	readonly target: LinkTarget | null;
	readonly label: GestureLabel | null;
	/** A bar lifted by a long-press, before it moves. */
	readonly lifted: number | null;
	/** The link selected for removal, drawn like a hovered one. */
	readonly selectedLink: number | null;
}

export const NO_GESTURE: GestureOverlay = {
	handles: null,
	ghosts: [],
	band: null,
	target: null,
	label: null,
	lifted: null,
	selectedLink: null,
};

export type Note = (x: number, y: number, w: number, h: number) => void;

const rect: MutableRect = { x: 0, y: 0, w: 0, h: 0 };
const place: MutableRect = { x: 0, y: 0, w: 0, h: 0 };

/** Whether a gesture draws anything, so that the overlay does not take its shortcut. */
export function drawsGesture(g: GestureOverlay | undefined): boolean {
	return (
		g !== undefined &&
		(g.ghosts.length > 0 ||
			g.band !== null ||
			g.target !== null ||
			g.label !== null ||
			g.lifted !== null)
	);
}

function barShape(
	ctx: CanvasRenderingContext2D,
	kind: string | undefined,
	b: MutableRect,
	radius: number,
	grow = 0,
): void {
	if (kind === 'milestone') {
		const cx = b.x + b.w / 2;
		const cy = b.y + b.h / 2;
		const r = b.w / 2 + grow;
		ctx.beginPath();
		ctx.moveTo(cx, cy - r);
		ctx.lineTo(cx + r, cy);
		ctx.lineTo(cx, cy + r);
		ctx.lineTo(cx - r, cy);
		ctx.closePath();
		return;
	}
	roundedRect(ctx, b.x - grow, b.y - grow, b.w + 2 * grow, b.h + 2 * grow, radius + grow);
}

/** Diagonal lines across a rectangle (the pending hatch), clipped by the caller. */
function hatch(ctx: CanvasRenderingContext2D, b: MutableRect, step: number): void {
	ctx.beginPath();
	for (let x = b.x - b.h; x < b.x + b.w; x += step) {
		ctx.moveTo(x, b.y + b.h);
		ctx.lineTo(x + b.h, b.y);
	}
	ctx.stroke();
}

function paintGhost(f: PaintFrame, g: Ghost, lifted: boolean, note: Note): void {
	const { ctx, layout, model, theme } = f;
	const r = model.rows[g.row];
	if (!r) return;
	placeBar(place, r.kind, g.start, g.end, layout.rowTop(g.row), layout.scale, layout.metrics);
	const shape = (): void => barShape(ctx, r.kind, place, Math.min(theme.barRadius, place.w / 3));
	const colour = g.blocked || g.state === 'not-scheduled' ? theme.critical : theme.pending;
	ctx.save();
	if (g.state !== 'not-scheduled') {
		ctx.globalAlpha = g.state === 'preview' ? 0.28 : 0.18;
		ctx.fillStyle = colour;
		shape();
		ctx.fill();
		ctx.globalAlpha = 1;
		if (g.complete !== null && g.complete > 0 && r.kind !== 'milestone') {
			ctx.globalAlpha = 0.35;
			ctx.fillRect(place.x, place.y, (place.w * Math.min(100, g.complete)) / 100, place.h);
			ctx.globalAlpha = 1;
		}
		if (g.state === 'pending') {
			ctx.save();
			shape();
			ctx.clip();
			ctx.strokeStyle = colour;
			ctx.lineWidth = 1;
			ctx.globalAlpha = 0.55;
			hatch(ctx, place, 6);
			ctx.restore();
		}
	}
	if (lifted) {
		ctx.shadowColor = theme.barShadow;
		ctx.shadowBlur = 10;
		ctx.shadowOffsetY = 3;
	}
	ctx.strokeStyle = colour;
	ctx.lineWidth = theme.outlineWidth + 0.5;
	ctx.setLineDash(g.state === 'pending' ? [] : [theme.dash, theme.dash * 0.75]);
	shape();
	ctx.stroke();
	ctx.restore();
	const pad = theme.outlineWidth + 12;
	note(place.x - pad, place.y - pad, place.w + 2 * pad, place.h + 2 * pad);
}

/** A grip on the size handle's edge, the dot beside the end and the knob on the foot. */
function paintHandles(f: PaintFrame, row: number, set: HandleSet, note: Note): void {
	const { ctx, layout, theme } = f;
	if (!layout.barInto(row, rect)) return;
	const bar = rect;
	const m = layout.metrics;
	ctx.save();
	if (set.resize !== null) {
		const [x0, x1] = resizeSpan(bar, set.resize, m);
		const w = theme.handleGrip;
		const inside = set.resize === 'end' ? bar.x + bar.w - w - 2 : bar.x + 2;
		const h = Math.max(8, bar.h - 8);
		ctx.fillStyle = theme.accent;
		roundedRect(ctx, inside, bar.y + (bar.h - h) / 2, w, h, w / 2);
		ctx.fill();
		note(Math.min(x0, inside) - 2, bar.y - 2, Math.abs(x1 - x0) + 4, bar.h + 4);
	}
	if (set.link) {
		const c = dotCentre(bar, m);
		const r = theme.handleDot;
		ctx.beginPath();
		ctx.arc(c.x, c.y, r + 1.5, 0, Math.PI * 2);
		ctx.fillStyle = theme.surface;
		ctx.fill();
		ctx.beginPath();
		ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
		ctx.fillStyle = theme.accent;
		ctx.fill();
		note(c.x - r - 3, c.y - r - 3, 2 * r + 6, 2 * r + 6);
	}
	if (set.progress !== null) {
		const k = knobCentre(bar, set.progress);
		const s = theme.knobSize;
		ctx.beginPath();
		ctx.moveTo(k.x, k.y - s * 0.9);
		ctx.lineTo(k.x + s, k.y + s * 0.6);
		ctx.lineTo(k.x - s, k.y + s * 0.6);
		ctx.closePath();
		ctx.fillStyle = theme.surface;
		ctx.fill();
		ctx.strokeStyle = theme.accent;
		ctx.lineWidth = 2;
		ctx.lineJoin = 'round';
		ctx.stroke();
		note(k.x - s - 3, k.y - s - 3, 2 * s + 6, 2 * s + 6);
	}
	ctx.restore();
}

function paintBand(f: PaintFrame, band: Band, ok: boolean, note: Note): void {
	const { ctx, layout, theme } = f;
	if (!layout.barInto(band.fromRow, rect)) return;
	const from = dotCentre(rect, layout.metrics);
	const to = { x: band.x ?? from.x, y: band.y ?? from.y };
	ctx.save();
	ctx.strokeStyle = ok ? theme.accent : theme.critical;
	ctx.fillStyle = ctx.strokeStyle;
	ctx.lineWidth = 2;
	ctx.lineCap = 'round';
	ctx.setLineDash([theme.dash, theme.dash * 0.6]);
	ctx.beginPath();
	ctx.moveTo(from.x, from.y);
	ctx.lineTo(to.x, to.y);
	ctx.stroke();
	ctx.setLineDash([]);
	// The arrow head, on the pointer's end.
	const a = Math.atan2(to.y - from.y, to.x - from.x);
	const s = theme.arrowSize + 2;
	ctx.beginPath();
	ctx.moveTo(to.x, to.y);
	ctx.lineTo(to.x - s * Math.cos(a - 0.45), to.y - s * Math.sin(a - 0.45));
	ctx.lineTo(to.x - s * Math.cos(a + 0.45), to.y - s * Math.sin(a + 0.45));
	ctx.closePath();
	ctx.fill();
	ctx.beginPath();
	ctx.arc(from.x, from.y, theme.handleDot + 2, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
	const x0 = Math.min(from.x, to.x) - 12;
	const y0 = Math.min(from.y, to.y) - 12;
	note(x0, y0, Math.abs(to.x - from.x) + 24, Math.abs(to.y - from.y) + 24);
}

function paintTarget(f: PaintFrame, t: LinkTarget, note: Note): void {
	const { ctx, layout, model, theme } = f;
	if (!layout.barInto(t.row, rect)) return;
	const kind = model.rows[t.row]?.kind;
	ctx.save();
	ctx.strokeStyle = t.ok ? theme.accent : theme.critical;
	ctx.lineWidth = theme.ringWidth + 1;
	barShape(ctx, kind, rect, Math.min(theme.barRadius, rect.w / 3) + 3, 3);
	ctx.stroke();
	if (!t.ok) {
		ctx.globalAlpha = 0.14;
		ctx.fillStyle = theme.critical;
		ctx.fill();
	}
	ctx.restore();
	const pad = theme.ringWidth + 8;
	note(rect.x - pad, rect.y - pad, rect.w + 2 * pad, rect.h + 2 * pad);
}

/** The label of a gesture: a pill by the pointer, inverted so that it reads on any colour. */
function paintLabel(f: PaintFrame, l: GestureLabel, note: Note): void {
	const { ctx, theme, win } = f;
	ctx.save();
	ctx.font = `${theme.fontWeightStrong} ${theme.labelSize + 1}px ${theme.fontSans}`;
	ctx.textBaseline = 'middle';
	const h = theme.labelSize + 12;
	// Hung to the right of the pointer and above it; flipped to stay inside the painted window.
	const left = Math.max(win.x, l.within?.left ?? win.x) + 4;
	const right = Math.min(win.x + win.w, l.within?.right ?? win.x + win.w) - 4;
	// A sentence longer than what can be seen is cut with an ellipsis (the toast says it whole).
	let text = l.text;
	while (text.length > 4 && textWidth(ctx, text) + 16 > right - left) {
		text = `${text.slice(0, -2).trimEnd()}…`;
	}
	const w = textWidth(ctx, text) + 16;
	let x = l.x + 14;
	if (x + w > right) x = Math.max(left, l.x - 14 - w);
	const y = Math.max(win.y + 4, l.y - h - 10);
	ctx.fillStyle = l.blocked ? theme.critical : theme.text;
	roundedRect(ctx, x, y, w, h, h / 2);
	ctx.fill();
	ctx.fillStyle = l.blocked ? theme.criticalInk : theme.surface;
	ctx.fillText(text, x + 8, y + h / 2 + 0.5);
	ctx.restore();
	note(x - 2, y - 2, w + 4, h + 4);
}

/**
 * Draws the gesture layer over the rings. `selectedRow` is the row whose handles show (they hide
 * while a drag has the bar, which is then drawn as its preview).
 */
export function paintGestures(
	f: PaintFrame,
	g: GestureOverlay,
	selectedRow: number | null,
	inRange: (row: number) => boolean,
	note: Note,
): void {
	const dragging = g.ghosts.some((x) => x.state === 'preview');
	if (g.handles && selectedRow !== null && inRange(selectedRow) && !dragging && !g.band) {
		paintHandles(f, selectedRow, g.handles, note);
	}
	for (const ghost of g.ghosts) {
		if (inRange(ghost.row)) paintGhost(f, ghost, g.lifted === ghost.row, note);
	}
	if (g.lifted !== null && inRange(g.lifted) && !g.ghosts.some((x) => x.row === g.lifted)) {
		const r = f.model.rows[g.lifted];
		if (r && r.start !== null && r.end !== null) {
			paintGhost(
				f,
				{ row: g.lifted, start: r.start, end: r.end, state: 'preview', complete: null },
				true,
				note,
			);
		}
	}
	if (g.band && inRange(g.band.fromRow)) paintBand(f, g.band, g.target?.ok ?? true, note);
	if (g.target && inRange(g.target.row)) paintTarget(f, g.target, note);
	if (g.label) paintLabel(f, g.label, note);
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The bars layer (phase-2.md 8.1; ADR-0009 "Mainspring refined"): links first, then the bars,
 * each with its label. Only rows in the painted window are drawn, and only bars that touch it.
 *
 * - A task is a brushed-brass pill: a vertical gradient, a lit top edge, a soft shadow, a thin
 *   brass outline (so that it reaches 3:1 against the panel, WCAG 1.4.11) and, when the plan has
 *   `complete`, a translucent brass overlay over the done part.
 * - A critical task is a ruby pill with white text, a heavier edge and a post at its finish (ADR-0009).
 * - A summary is a thin stem with a short cap at each end, in a muted ink: no heavy slab.
 * - A milestone is a brass jewel: a rounded diamond with a gradient and a soft glow.
 * - Beside a bar, avatars with the initials of the people on it; the name of a task that is too
 *   short to hold its own name goes there too.
 *
 * Meaning never rests on colour alone (WCAG 1.4.1): a critical bar is also marked by its heavier edge,
 * gradient and white text and the treegrid's critical column, a text-only bar is dashed, a summary
 * has end caps, a milestone is a diamond. When the schedule on screen is not the newest outcome
 * (an edit broke it) the shapes and lines are drawn faded, the "last good" rule; the labels stay
 * at full strength so that they keep their contrast (WCAG 1.4.3).
 */
import type { GanttRow } from '../model';
import { rowRange, type GanttLayout, type MutableRect, type Rect } from '../layout';
import { barFont, labelFont, roundedRect, textWidth, toContent, type PaintFrame } from './canvas';
import { layerFor } from './incremental';
import { paintLinks } from './links';
import { motionFor } from './motion';
import type { Theme } from './theme';

/** How far right of a bar its label may reach, for deciding whether to draw a bar at all. */
const LABEL_REACH = 360;
/** Avatars shown beside a bar before "+n". */
const MAX_AVATARS = 3;

type GradientKey = 'brass' | 'steel' | 'jewel' | 'steelJewel';
interface Gradients {
	readonly theme: Theme;
	readonly made: Partial<Record<GradientKey, CanvasGradient>>;
}
const gradients = new WeakMap<object, Gradients>();

/**
 * One gradient per style, made once per canvas context and theme, in unit space: a bar's gradient
 * runs 0 to 1 down a unit square (a jewel's, -1 to 1), and `fillUnit` moves and scales the
 * coordinate frame onto the bar when it fills. Making a gradient per bar per repaint was the most
 * costly line of the painter after the shadow blur.
 */
function gradientFor(
	ctx: CanvasRenderingContext2D,
	theme: Theme,
	key: GradientKey,
): CanvasGradient {
	let cache = gradients.get(ctx);
	if (!cache || cache.theme !== theme) {
		cache = { theme, made: {} };
		gradients.set(ctx, cache);
	}
	let g = cache.made[key];
	if (g) return g;
	const jewel = key === 'jewel' || key === 'steelJewel';
	g = ctx.createLinearGradient(0, jewel ? -1 : 0, 0, 1);
	if (key === 'brass') {
		g.addColorStop(0, theme.barTop);
		g.addColorStop(1, theme.barBottom);
	} else if (key === 'steel') {
		g.addColorStop(0, theme.criticalTop);
		g.addColorStop(1, theme.criticalBottom);
	} else if (key === 'jewel') {
		g.addColorStop(0, theme.jewelHigh);
		g.addColorStop(0.55, theme.milestone);
		g.addColorStop(1, theme.jewelDeep);
	} else {
		g.addColorStop(0, theme.criticalTop);
		g.addColorStop(0.55, theme.critical);
		g.addColorStop(1, theme.criticalBottom);
	}
	cache.made[key] = g;
	return g;
}

/**
 * Fills the current path with a unit-space gradient, mapped onto the box at (x, y) of size
 * (1, sy) times `sy`. The path's points are already fixed in the canvas by the time the frame
 * moves, so only the gradient follows it.
 */
function fillUnit(f: PaintFrame, g: CanvasGradient, x: number, y: number, sy: number): void {
	const { ctx, win, dpr } = f;
	ctx.fillStyle = g;
	ctx.transform(1, 0, 0, sy, x, y);
	ctx.fill();
	toContent(ctx, win, dpr);
}

/**
 * A soft shadow without `shadowBlur` (which costs several times the fill itself): the shape's
 * outline filled again, offset down and grown, once for a small blur and twice, the outer one
 * fainter, for a large one. `path` adds the outline grown by `grow` and moved by `dy` to the
 * current path.
 */
function softShadow(
	ctx: CanvasRenderingContext2D,
	colour: string,
	blur: number,
	path: (grow: number) => void,
): void {
	if (blur <= 0) return;
	const layers = blur >= 4 ? 2 : 1;
	const alpha = ctx.globalAlpha;
	ctx.fillStyle = colour;
	for (let k = 0; k < layers; k++) {
		ctx.globalAlpha = (alpha * (k + 1)) / layers;
		path((blur / 2) * ((layers - k) / layers));
		ctx.fill();
	}
	ctx.globalAlpha = alpha;
}

function drawSummary(ctx: CanvasRenderingContext2D, r: Rect, colour: string, t: Theme): void {
	const stem = Math.min(r.h, t.summaryStem);
	const cap = Math.min(t.summaryCap, r.w / 2);
	ctx.fillStyle = colour;
	ctx.fillRect(r.x, r.y, r.w, stem);
	ctx.fillRect(r.x, r.y, cap, r.h);
	ctx.fillRect(r.x + r.w - cap, r.y, cap, r.h);
}

/**
 * The critical path's second cue besides its colour (WCAG 1.4.1): a post at the bar's finish edge,
 * taller than the bar, in the critical colour. A critical task also has a heavier edge, and a
 * critical milestone a heavier one than the plain milestone's.
 */
function drawPost(f: PaintFrame, bar: Rect): void {
	const { ctx, theme } = f;
	const cy = bar.y + bar.h / 2;
	const h = bar.h + 2 * theme.criticalPostReach;
	ctx.fillStyle = theme.critical;
	ctx.fillRect(bar.x + bar.w + theme.criticalEdgeWidth, cy - h / 2, theme.criticalPostWidth, h);
}

/** A brass pill, or with `steel` a critical one: a heavier edge in the critical colour. */
function drawPill(f: PaintFrame, row: GanttRow, bar: Rect, steel: boolean): void {
	const { ctx, theme } = f;
	// A short bar keeps its width and a smaller radius, so it does not turn into a circle.
	const radius = Math.min(theme.barRadius, bar.w / 3);
	const dy = steel ? theme.criticalShadowY : theme.barShadowY;

	softShadow(
		ctx,
		steel ? theme.criticalShadow : theme.barShadow,
		steel ? theme.criticalShadowBlur : theme.barShadowBlur,
		(g) => roundedRect(ctx, bar.x - g, bar.y + dy - g, bar.w + 2 * g, bar.h + 2 * g, radius + g),
	);
	roundedRect(ctx, bar.x, bar.y, bar.w, bar.h, radius);
	fillUnit(f, gradientFor(ctx, theme, steel ? 'steel' : 'brass'), bar.x, bar.y, bar.h);

	// The done part, the lit top edge and the shaded bottom edge, clipped to the pill.
	ctx.save();
	roundedRect(ctx, bar.x, bar.y, bar.w, bar.h, radius);
	ctx.clip();
	if (row.complete !== null && row.complete > 0) {
		ctx.fillStyle = steel ? theme.criticalProgress : theme.barProgress;
		ctx.fillRect(bar.x, bar.y, (bar.w * Math.min(100, row.complete)) / 100, bar.h);
	}
	ctx.fillStyle = steel ? theme.criticalHighlight : theme.barHighlight;
	ctx.fillRect(bar.x, bar.y, bar.w, 1);
	if (!steel) {
		ctx.fillStyle = theme.barLowlight;
		ctx.fillRect(bar.x, bar.y + bar.h - 1, bar.w, 1);
	}
	ctx.restore();

	// The edge: a 1 px outline in brass so that a pale bar meets 3:1 (WCAG 1.4.11), and a heavier
	// one in the critical colour, which is also the shape cue of the critical path.
	roundedRect(ctx, bar.x, bar.y, bar.w, bar.h, radius);
	ctx.strokeStyle = steel ? theme.critical : theme.barOutline;
	ctx.lineWidth = steel ? theme.criticalEdgeWidth : theme.barOutlineWidth;
	ctx.stroke();
}

/** The dashed outline of a task the editor cannot edit (text only). */
function drawTextOnly(f: PaintFrame, bar: Rect, alpha: number): void {
	const { ctx, theme } = f;
	const radius = Math.min(theme.barRadius, bar.w / 3);
	roundedRect(ctx, bar.x, bar.y, bar.w, bar.h, radius);
	ctx.globalAlpha = alpha * theme.textOnlyOpacity;
	ctx.fillStyle = theme.textOnly;
	ctx.fill();
	ctx.globalAlpha = alpha;
	ctx.strokeStyle = theme.textOnly;
	ctx.lineWidth = theme.outlineWidth;
	ctx.setLineDash([theme.dash, theme.dash * 0.75]);
	ctx.stroke();
	ctx.setLineDash([]);
}

/** A rounded diamond of half-diagonal `half` about (cx, cy), as the current path. */
function diamondPath(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	half: number,
	radius: number,
): void {
	const side = half * Math.SQRT2;
	// Built turned a quarter, so that the transform is gone before anything is filled.
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(Math.PI / 4);
	roundedRect(ctx, -side / 2, -side / 2, side, side, radius);
	ctx.restore();
}

/** A jewel: a rounded diamond, lit from above, with a soft glow and a brass (or critical) edge. */
function drawJewel(f: PaintFrame, bar: Rect, critical: boolean): void {
	const { ctx, theme } = f;
	const cx = bar.x + bar.w / 2;
	const cy = bar.y + bar.h / 2;
	const half = bar.w / 2;
	softShadow(ctx, critical ? theme.criticalShadow : theme.jewelGlow, theme.jewelBlur, (g) =>
		diamondPath(ctx, cx, cy + theme.jewelY, half + g, theme.milestoneRadius + g),
	);
	diamondPath(ctx, cx, cy, half, theme.milestoneRadius);
	fillUnit(f, gradientFor(ctx, theme, critical ? 'steelJewel' : 'jewel'), cx, cy, half);
	// The upper half of the light jewel is under 3:1 on the light panel: an edge brings it up.
	ctx.strokeStyle = critical ? theme.critical : theme.link;
	ctx.lineWidth = critical ? theme.criticalEdgeWidth : theme.barOutlineWidth;
	ctx.stroke();
}

/** One avatar: a coloured circle with an initial, ringed in the panel colour. Returns its width. */
function drawAvatar(f: PaintFrame, x: number, cy: number, name: string, colour: number): number {
	const { ctx, theme } = f;
	const size = theme.avatarSize;
	const { bg, ink } = theme.avatars[colour % theme.avatars.length] ??
		theme.avatars[0] ?? {
			bg: theme.inset,
			ink: theme.text,
		};
	ctx.beginPath();
	ctx.arc(x + size / 2, cy, size / 2 + 2, 0, Math.PI * 2);
	ctx.fillStyle = theme.surface;
	ctx.fill();
	ctx.beginPath();
	ctx.arc(x + size / 2, cy, size / 2, 0, Math.PI * 2);
	ctx.fillStyle = bg;
	ctx.fill();
	ctx.fillStyle = ink;
	ctx.font = `700 ${theme.avatarFontSize}px ${theme.fontSans}`;
	ctx.textAlign = 'center';
	ctx.fillText(Array.from(name.trim())[0]?.toUpperCase() ?? '?', x + size / 2, cy + 0.5);
	ctx.textAlign = 'left';
	return size;
}

/** Where `drawBeside` put the avatars: x of the first ring and of the end; NaN for none. */
const span = { x0: NaN, x1: NaN };

/** The label beside a bar: the name when it did not fit, then the avatars, from `x`. */
function drawBeside(f: PaintFrame, row: GanttRow, x: number, cy: number, withName: boolean): void {
	const { ctx, theme } = f;
	let at = x;
	span.x0 = NaN;
	span.x1 = NaN;
	if (withName) {
		const display = row.kind === 'milestone';
		ctx.font = display ? `${theme.displaySize}px ${theme.fontDisplay}` : labelFont(theme);
		ctx.fillStyle = display ? theme.text : theme.textMuted;
		ctx.fillText(row.name, at, cy + 0.5);
		at += textWidth(ctx, row.name) + theme.labelGap;
	}
	const shown = row.people.slice(0, MAX_AVATARS);
	if (shown.length > 0) span.x0 = at - 2;
	shown.forEach((name, i) => {
		at += drawAvatar(f, at, cy, name, row.peopleIndex[i] ?? 0) + theme.avatarGap;
	});
	if (shown.length > 0) span.x1 = at - theme.avatarGap + 2;
	if (row.people.length > shown.length) {
		const more = `+${row.people.length - shown.length}`;
		ctx.font = labelFont(theme);
		ctx.fillStyle = theme.textMuted;
		ctx.fillText(more, at, cy + 0.5);
		span.x1 = at + textWidth(ctx, more);
	}
}

const bar: MutableRect = { x: 0, y: 0, w: 0, h: 0 };

/** Paints the links and bars that touch `area` (clipped and cleared by the layer). */
function drawBars(f: PaintFrame, area: Rect): void {
	const { ctx, model, theme, layout } = f;
	const alpha = model.dimmed ? theme.dimOpacity : 1;
	ctx.globalAlpha = alpha;
	paintLinks(f, area);

	ctx.textBaseline = 'middle';
	const { first, last } = rowRange(layout, area.y, area.h, 0);
	const rows = model.rows;
	for (let i = first; i < last; i++) {
		const row: GanttRow | undefined = rows[i];
		if (!row || !layout.barInto(i, bar)) continue;
		// The float tail and the label may reach right of the bar: look past it.
		const tailReach = row.lateEnd !== null ? layout.scale.x(row.lateEnd) - bar.x - bar.w : 0;
		const right = bar.x + bar.w + Math.max(0, tailReach) + LABEL_REACH;
		if (bar.x > area.x + area.w || right < area.x) continue;
		const cy = bar.y + bar.h / 2;

		if (row.floatMin !== null && row.floatMin > 0 && row.lateEnd !== null) {
			const tail = layout.scale.x(row.lateEnd) - (bar.x + bar.w);
			if (tail > 1) drawFloat(f, layout, row, bar, cy);
		}

		if (row.kind === 'milestone') drawJewel(f, bar, row.critical);
		else if (row.kind === 'container') {
			drawSummary(ctx, bar, row.critical ? theme.critical : theme.summary, theme);
		} else if (row.textOnly) drawTextOnly(f, bar, alpha);
		else drawPill(f, row, bar, row.critical);
		if (row.critical && row.kind !== 'milestone') drawPost(f, bar);

		// Labels are not faded with the rest.
		ctx.globalAlpha = 1;
		ctx.textAlign = 'left';
		ctx.font = barFont(theme);
		const nameWidth = textWidth(ctx, row.name);
		const inside = row.kind === 'task' && !row.textOnly && nameWidth + 2 * theme.labelPad <= bar.w;
		if (inside) {
			ctx.fillStyle = row.critical ? theme.criticalInk : theme.barInk;
			ctx.fillText(row.name, bar.x + theme.labelPad, cy + 0.5);
		}
		const tail =
			row.lateEnd !== null && row.floatMin !== null && row.floatMin > 0
				? Math.max(layout.scale.x(row.lateEnd), bar.x + bar.w)
				: bar.x + bar.w;
		drawBeside(f, row, tail + theme.labelGap, cy, !inside && row.kind !== 'container');
		// Tell hit testing where the avatars are, so that a link under them does not win.
		layout.avatars[2 * i] = span.x0;
		layout.avatars[2 * i + 1] = span.x1;
		ctx.globalAlpha = alpha;
	}
	ctx.globalAlpha = 1;
}

/**
 * Paints the bars layer for a window. A move of the window paints it again in pieces over frames,
 * the middle first (incremental.ts); a new model, layout, theme or ratio, and each frame of a
 * reschedule tween, paint it all at once.
 */
export function paintBars(f: PaintFrame): void {
	const { ctx, model } = f;
	// A reschedule tween puts the bars that are moving between where they were and where they are.
	const motion = f.motion ?? motionFor(ctx);
	const layout: GanttLayout = motion.layoutFor(model, f.layout);
	const frame: PaintFrame = layout === f.layout ? f : { ...f, layout };
	// The layout in use is a key: a tween frame has a new one each time, and the frame after it
	// the target again, so both are painted in full.
	layerFor(ctx, 'bars', drawBars).paint(frame, [model, layout, f.theme, f.dpr], { sliced: true });
	// A tween in progress asks for the next frame of the bars layer only.
	motion.continueWith(() => paintBars(f));
}

/**
 * The float tail (BUILD_PLAN "a faint tail after each bar"): a fine dotted line from the bar's end
 * to its late finish, and a short solid stop at the late finish, in a muted ink that differs from
 * the brass links. Faint, so a plan with much float
 * (Fedora's milestones float to the plan's end) does not read as a second set of bars or links.
 */
function drawFloat(f: PaintFrame, layout: GanttLayout, row: GanttRow, bar: Rect, cy: number): void {
	const { ctx, theme } = f;
	const x0 = bar.x + bar.w;
	const tail = layout.scale.x(row.lateEnd ?? 0) - x0;
	const h = theme.floatHeight;
	ctx.save();
	// Relative to the caller's alpha, so a dimmed (out-of-date) chart dims its tails too.
	const alpha = ctx.globalAlpha;
	ctx.strokeStyle = theme.float;
	ctx.lineWidth = h;
	ctx.globalAlpha = alpha * theme.floatOpacity;
	ctx.setLineDash([h, h * 2]);
	ctx.beginPath();
	ctx.moveTo(x0 + h, cy);
	ctx.lineTo(x0 + tail, cy);
	ctx.stroke();
	ctx.setLineDash([]);
	ctx.globalAlpha = alpha;
	ctx.fillStyle = theme.float;
	ctx.fillRect(x0 + tail - h / 2, cy - h * 3, h, h * 6);
	ctx.restore();
}

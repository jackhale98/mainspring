// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The bars layer (phase-2.md 8.1; ADR-0009 "Mainspring refined"): links first, then the bars,
 * each with its label. Only rows in the painted window are drawn, and only bars that touch it.
 *
 * - A task is a brushed-brass pill: a vertical gradient, a lit top edge, a soft shadow, a thin
 *   brass outline (so that it reaches 3:1 against the panel, WCAG 1.4.11) and, when the plan has
 *   `complete`, a translucent brass overlay over the done part.
 * - A critical task is a blued-steel pill with white text, no outline and a blue shadow.
 * - A summary is a thin stem with a short cap at each end, in a muted ink: no heavy slab.
 * - A milestone is a brass jewel: a rounded diamond with a gradient and a soft glow.
 * - Beside a bar, avatars with the initials of the people on it; the name of a task that is too
 *   short to hold its own name goes there too.
 *
 * Meaning never rests on colour alone (WCAG 1.4.1): a critical bar is also marked by its steel
 * gradient and white text and the treegrid's critical column, a text-only bar is dashed, a summary
 * has end caps, a milestone is a diamond. When the schedule on screen is not the newest outcome
 * (an edit broke it) the shapes and lines are drawn faded, the "last good" rule; the labels stay
 * at full strength so that they keep their contrast (WCAG 1.4.3).
 */
import type { GanttRow } from '../model';
import { rowRange, type GanttLayout, type Rect } from '../layout';
import {
	barFont,
	begin,
	labelFont,
	roundedRect,
	textWidth,
	type PaintFrame,
} from './canvas';
import { paintLinks } from './links';
import type { Theme } from './theme';

/** How far right of a bar its label may reach, for deciding whether to draw a bar at all. */
const LABEL_REACH = 360;
/** Avatars shown beside a bar before "+n". */
const MAX_AVATARS = 3;

function drawSummary(ctx: CanvasRenderingContext2D, r: Rect, colour: string, t: Theme): void {
	const stem = Math.min(r.h, t.summaryStem);
	const cap = Math.min(t.summaryCap, r.w / 2);
	ctx.fillStyle = colour;
	ctx.fillRect(r.x, r.y + (r.h - stem) / 2 - (r.h - stem) / 2, r.w, stem);
	ctx.fillRect(r.x, r.y, cap, r.h);
	ctx.fillRect(r.x + r.w - cap, r.y, cap, r.h);
}

function gradientFor(
	ctx: CanvasRenderingContext2D,
	bar: Rect,
	top: string,
	bottom: string,
): CanvasGradient {
	const g = ctx.createLinearGradient(0, bar.y, 0, bar.y + bar.h);
	g.addColorStop(0, top);
	g.addColorStop(1, bottom);
	return g;
}

/** A brass pill, or with `steel` a blued-steel one. */
function drawPill(f: PaintFrame, row: GanttRow, bar: Rect, steel: boolean): void {
	const { ctx, theme, dpr } = f;
	// A short bar keeps its width and a smaller radius, so it does not turn into a circle.
	const radius = Math.min(theme.barRadius, bar.w / 3);
	const blur = steel ? theme.steelShadowBlur : theme.barShadowBlur;
	const offset = steel ? theme.steelShadowY : theme.barShadowY;

	ctx.save();
	// Shadow sizes are device pixels: they do not follow the canvas transform.
	ctx.shadowColor = steel ? theme.steelShadow : theme.barShadow;
	ctx.shadowBlur = blur * dpr;
	ctx.shadowOffsetY = offset * dpr;
	roundedRect(ctx, bar.x, bar.y, bar.w, bar.h, radius);
	ctx.fillStyle = steel
		? gradientFor(ctx, bar, theme.steelTop, theme.steelBottom)
		: gradientFor(ctx, bar, theme.barTop, theme.barBottom);
	ctx.fill();
	ctx.restore();

	// The done part, the lit top edge and the shaded bottom edge, clipped to the pill.
	ctx.save();
	roundedRect(ctx, bar.x, bar.y, bar.w, bar.h, radius);
	ctx.clip();
	if (row.complete !== null && row.complete > 0) {
		ctx.fillStyle = steel ? theme.steelProgress : theme.barProgress;
		ctx.fillRect(bar.x, bar.y, (bar.w * Math.min(100, row.complete)) / 100, bar.h);
	}
	ctx.fillStyle = steel ? theme.steelHighlight : theme.barHighlight;
	ctx.fillRect(bar.x, bar.y, bar.w, 1);
	if (!steel) {
		ctx.fillStyle = theme.barLowlight;
		ctx.fillRect(bar.x, bar.y + bar.h - 1, bar.w, 1);
	}
	ctx.restore();

	// Brass pills have an outline for contrast; steel ones are dark enough without.
	if (!steel) {
		roundedRect(ctx, bar.x, bar.y, bar.w, bar.h, radius);
		ctx.strokeStyle = theme.barOutline;
		ctx.lineWidth = theme.barOutlineWidth;
		ctx.stroke();
	}
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

/** A jewel: a rounded diamond, lit from above, with a soft glow. */
function drawJewel(f: PaintFrame, bar: Rect, critical: boolean): void {
	const { ctx, theme, dpr } = f;
	const cx = bar.x + bar.w / 2;
	const cy = bar.y + bar.h / 2;
	const half = bar.w / 2;
	const side = half * Math.SQRT2;
	ctx.save();
	// The path is built turned a quarter, and filled in the upright frame, so that the gradient
	// runs top to bottom of the diamond.
	ctx.translate(cx, cy);
	ctx.rotate(Math.PI / 4);
	roundedRect(ctx, -side / 2, -side / 2, side, side, theme.milestoneRadius);
	ctx.rotate(-Math.PI / 4);
	ctx.translate(-cx, -cy);
	const g = ctx.createLinearGradient(0, cy - half, 0, cy + half);
	g.addColorStop(0, critical ? theme.steelTop : theme.jewelHigh);
	g.addColorStop(0.55, critical ? theme.critical : theme.milestone);
	g.addColorStop(1, critical ? theme.steelBottom : theme.jewelDeep);
	ctx.shadowColor = critical ? theme.steelShadow : theme.jewelGlow;
	ctx.shadowBlur = theme.jewelBlur * dpr;
	ctx.shadowOffsetY = theme.jewelY * dpr;
	ctx.fillStyle = g;
	ctx.fill();
	ctx.restore();
}

/** One avatar: a coloured circle with an initial, ringed in the panel colour. Returns its width. */
function drawAvatar(f: PaintFrame, x: number, cy: number, name: string, colour: number): number {
	const { ctx, theme } = f;
	const size = theme.avatarSize;
	const { bg, ink } = theme.avatars[colour % theme.avatars.length] ?? theme.avatars[0] ?? {
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

/** The label beside a bar: the name when it did not fit, then the avatars, from `x`. */
function drawBeside(f: PaintFrame, row: GanttRow, x: number, cy: number, withName: boolean): void {
	const { ctx, theme } = f;
	let at = x;
	if (withName) {
		const display = row.kind === 'milestone';
		ctx.font = display
			? `${theme.displaySize}px ${theme.fontDisplay}`
			: labelFont(theme);
		ctx.fillStyle = display ? theme.text : theme.textMuted;
		ctx.fillText(row.name, at, cy + 0.5);
		at += textWidth(ctx, row.name) + theme.labelGap;
	}
	const shown = row.people.slice(0, MAX_AVATARS);
	shown.forEach((name, i) => {
		at += drawAvatar(f, at, cy, name, row.peopleIndex[i] ?? 0) + theme.avatarGap;
	});
	if (row.people.length > shown.length) {
		ctx.font = labelFont(theme);
		ctx.fillStyle = theme.textMuted;
		ctx.fillText(`+${row.people.length - shown.length}`, at, cy + 0.5);
	}
}

export function paintBars(f: PaintFrame): void {
	const { ctx, win, dpr, layout, model, theme } = f;
	begin(ctx, win, dpr);
	const alpha = model.dimmed ? theme.dimOpacity : 1;
	ctx.globalAlpha = alpha;
	paintLinks(f);

	ctx.textBaseline = 'middle';
	const { first, last } = rowRange(layout, win.y, win.h, 0);
	const rows = model.rows;
	for (let i = first; i < last; i++) {
		const row: GanttRow | undefined = rows[i];
		const bar = layout.barRect(i);
		if (!row || !bar) continue;
		// The float tail and the label may reach right of the bar: look past it.
		const tailReach = row.lateEnd !== null ? layout.scale.x(row.lateEnd) - bar.x - bar.w : 0;
		const right = bar.x + bar.w + Math.max(0, tailReach) + LABEL_REACH;
		if (bar.x > win.x + win.w || right < win.x) continue;
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

		// Labels are not faded with the rest.
		ctx.globalAlpha = 1;
		ctx.textAlign = 'left';
		ctx.font = barFont(theme);
		const nameWidth = textWidth(ctx, row.name);
		const inside =
			row.kind === 'task' && !row.textOnly && nameWidth + 2 * theme.labelPad <= bar.w;
		if (inside) {
			ctx.fillStyle = row.critical ? theme.steelInk : theme.barInk;
			ctx.fillText(row.name, bar.x + theme.labelPad, cy + 0.5);
		}
		const tail =
			row.lateEnd !== null && row.floatMin !== null && row.floatMin > 0
				? Math.max(layout.scale.x(row.lateEnd), bar.x + bar.w)
				: bar.x + bar.w;
		drawBeside(f, row, tail + theme.labelGap, cy, !inside);
		ctx.globalAlpha = alpha;
	}
	ctx.globalAlpha = 1;
}

function drawFloat(f: PaintFrame, layout: GanttLayout, row: GanttRow, bar: Rect, cy: number): void {
	const { ctx, theme } = f;
	const tail = layout.scale.x(row.lateEnd ?? 0) - (bar.x + bar.w);
	const h = theme.floatHeight;
	ctx.fillStyle = theme.float;
	ctx.fillRect(bar.x + bar.w, cy - h / 2, tail, h);
	ctx.fillRect(bar.x + bar.w + tail - h / 2, cy - h * 1.33, h / 2, h * 2.67);
}

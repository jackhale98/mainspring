// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The bars layer (phase-2.md 8.1): links first, then bars, summary bars and milestones, with a
 * label on or beside each. Only rows in the painted window are drawn, and only bars that touch
 * it. When the schedule on screen is not the newest outcome (an edit broke it), everything is
 * drawn faded, the "last good" rule.
 *
 * Meaning never rests on colour alone (WCAG 1.4.1): a critical bar has a thick outline as well
 * as its colour, a text-only bar is dashed, a summary bar has end notches, a milestone is a
 * diamond. The float tail (bridge v2 analysis, task T5) is a thin bar after the task's end.
 */
import type { GanttRow } from '../model';
import { rowRange, type Rect } from '../layout';
import { begin, labelFont, roundedRect, textWidth, type PaintFrame } from './canvas';
import { paintLinks } from './links';

/** How far right of a bar its label may reach, for deciding whether to draw a bar at all. */
const LABEL_REACH = 320;

function drawSummary(
	ctx: CanvasRenderingContext2D,
	r: Rect,
	colour: string,
	stemHeight: number,
): void {
	const stem = Math.min(r.h, stemHeight);
	ctx.fillStyle = colour;
	ctx.fillRect(r.x, r.y, r.w, stem);
	// Notches pointing down at both ends.
	const n = Math.min(r.h, r.w / 2);
	ctx.beginPath();
	ctx.moveTo(r.x, r.y + stem);
	ctx.lineTo(r.x + n, r.y + stem);
	ctx.lineTo(r.x, r.y + r.h);
	ctx.closePath();
	ctx.moveTo(r.x + r.w, r.y + stem);
	ctx.lineTo(r.x + r.w - n, r.y + stem);
	ctx.lineTo(r.x + r.w, r.y + r.h);
	ctx.closePath();
	ctx.fill();
}

function drawDiamond(ctx: CanvasRenderingContext2D, r: Rect, colour: string): void {
	const cx = r.x + r.w / 2;
	const cy = r.y + r.h / 2;
	ctx.fillStyle = colour;
	ctx.beginPath();
	ctx.moveTo(cx, r.y);
	ctx.lineTo(r.x + r.w, cy);
	ctx.lineTo(cx, r.y + r.h);
	ctx.lineTo(r.x, cy);
	ctx.closePath();
	ctx.fill();
}

export function paintBars(f: PaintFrame): void {
	const { ctx, win, dpr, layout, model, theme } = f;
	begin(ctx, win, dpr);
	const alpha = model.dimmed ? theme.dimOpacity : 1;
	ctx.globalAlpha = alpha;
	paintLinks(f);

	ctx.font = labelFont(theme);
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
			if (tail > 1) {
				const h = theme.floatHeight;
				ctx.fillStyle = theme.float;
				ctx.fillRect(bar.x + bar.w, cy - h / 2, tail, h);
				ctx.fillRect(bar.x + bar.w + tail - h / 2, cy - h * 1.33, h / 2, h * 2.67);
			}
		}

		if (row.kind === 'milestone') {
			drawDiamond(ctx, bar, row.critical ? theme.critical : theme.milestone);
		} else if (row.kind === 'container') {
			drawSummary(ctx, bar, row.critical ? theme.critical : theme.summary, theme.summaryStem);
		} else {
			roundedRect(ctx, bar.x, bar.y, bar.w, bar.h, theme.barRadius);
			if (row.textOnly) {
				ctx.globalAlpha = alpha * theme.textOnlyOpacity;
				ctx.fillStyle = theme.textOnly;
				ctx.fill();
				ctx.globalAlpha = alpha;
				ctx.strokeStyle = theme.textOnly;
				ctx.lineWidth = theme.outlineWidth;
				ctx.setLineDash([theme.dash, theme.dash * 0.75]);
				ctx.stroke();
				ctx.setLineDash([]);
			} else {
				// A pale fill with an outline that reaches 3:1 against the canvas (WCAG 1.4.11); a
				// critical bar has the accent colour as its fill tint and a thicker outline.
				ctx.fillStyle = row.critical ? theme.criticalFill : theme.bar;
				ctx.fill();
				if (row.complete !== null && row.complete > 0) {
					// The done part, clipped to the pill.
					ctx.save();
					ctx.clip();
					ctx.fillStyle = row.critical ? theme.critical : theme.barProgress;
					ctx.fillRect(bar.x, bar.y, (bar.w * Math.min(100, row.complete)) / 100, bar.h);
					ctx.restore();
				}
				ctx.strokeStyle = row.critical ? theme.critical : theme.barOutline;
				ctx.lineWidth = row.critical ? theme.criticalOutline : theme.barOutlineWidth;
				ctx.stroke();
			}
		}

		// The task's name inside its bar when it fits. To the right of the bar, in the muted label
		// colour and size: the name when it did not fit, then the people allocated.
		ctx.textAlign = 'left';
		const nameWidth = textWidth(ctx, row.name);
		const inside = row.kind === 'task' && !row.textOnly && nameWidth + 2 * theme.labelPad <= bar.w;
		if (inside) {
			ctx.fillStyle = theme.text;
			ctx.fillText(row.name, bar.x + theme.labelPad, cy + 0.5);
		}
		const outside = [inside ? '' : row.name, row.people.join(', ')].filter((t) => t !== '');
		if (outside.length > 0) {
			const tail =
				row.lateEnd !== null && row.floatMin !== null && row.floatMin > 0
					? layout.scale.x(row.lateEnd)
					: bar.x + bar.w;
			ctx.font = labelFont(theme, true);
			ctx.fillStyle = theme.textMuted;
			ctx.fillText(
				outside.join(' \u00b7 '),
				Math.max(tail, bar.x + bar.w) + theme.labelGap,
				cy + 0.5,
			);
			ctx.font = labelFont(theme);
		}
	}
	ctx.globalAlpha = 1;
}

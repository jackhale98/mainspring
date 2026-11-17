// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The lanes' two canvas layers (phase-3.md 8.1, 9.4), drawn in content coordinates over a window of
 * the content that moves with it, as the heatmap's layers are (heat-paint.ts):
 *
 * - `paintLanes`: the lanes. Per row in the window: a leaf person's lane has its leave as hatched
 *   blocks (a pattern per type, lane-patterns.ts), then its bars, each with the task's name where
 *   the name fits, a text-only task's bar dashed and faint with the "T" badge, then the over strip:
 *   a hatched red band at the foot of the lane over the periods that are over (never colour alone,
 *   WCAG 1.4.1). A group's row has the roll-up as a thin band in the band colours. One hairline per
 *   column and per row separates them. The count of fills is returned: the budget of 8.1 is 600
 *   per frame.
 * - `paintLanesOverlay`: what changes without a new model, as the heatmap's overlay (today and
 *   status lines, the selected and focused period, the drag target and its label: `paintOverlay`),
 *   and the bars the pointer is on, the lifted bar, and the bars of the selected task.
 *
 * No layout reads and no DOM except the pattern tiles (a small canvas each, cached).
 */
import { begin, roundedRect, textWidth } from '../gantt/paint/canvas';
import type { Theme } from '../gantt/paint/theme';
import { lanesStrings as L } from '../strings';
import type { Box, HeatLayout } from '../workload/heat-layout';
import { paintOverlay, stripes, type OverlayFrame, type PaintStats } from '../workload/heat-paint';
import type { HeatTheme } from '../workload/heat-theme';
import type { Band, Thresholds } from '../workload/types';
import { barBox, groupBox, leaveBox, overBox, visibleRuns } from './lane-geom';
import type { LaneBar, LanesModel } from './lane-model';
import { HATCH_OF, hatchPattern } from './lane-patterns';
import type { LaneTheme } from './lane-theme';

type Ctx = CanvasRenderingContext2D;

export interface LanesFrame {
	readonly ctx: Ctx;
	/** The painted window, in content coordinates. */
	readonly win: Box;
	readonly dpr: number;
	readonly layout: HeatLayout;
	readonly lanes: LanesModel;
	readonly thresholds: Thresholds;
	readonly heat: HeatTheme;
	readonly lane: LaneTheme;
	readonly theme: Theme;
}

const BAND_FILL = { off: 'off', spare: 'spare', full: 'full', over: 'over' } as const;

const PAD = 6;
const BADGE = 13;

function fillRun(ctx: Ctx, colour: string, b: Box): void {
	ctx.fillStyle = colour;
	ctx.fillRect(b.x, b.y, b.w, b.h);
}

/** A hatched red band: the over fill, then the diagonal lines over it. Returns the fills made. */
function fillOver(ctx: Ctx, heat: HeatTheme, dpr: number, b: Box): number {
	fillRun(ctx, heat.over, b);
	const p = stripes(ctx, 'diagonal', heat.overHatch, dpr);
	if (!p) return 1;
	ctx.fillStyle = p;
	ctx.fillRect(b.x, b.y, b.w, b.h);
	return 2;
}

/** The roll-up of a group: its bands over the window, a run of one band at a time. */
function paintGroupBand(f: LanesFrame, row: number, c0: number, c1: number): number {
	const { ctx, layout, lanes, heat, lane } = f;
	let fills = 0;
	let runStart = c0;
	let runBand: Band | null = null;
	for (let c = c0; c <= c1; c++) {
		const band = c < c1 ? lanes.load.band(row, c, f.thresholds) : null;
		if (band === runBand) continue;
		if (runBand !== null) {
			const b = groupBox(layout, lane, row, runStart, c);
			if (runBand === 'over') fills += fillOver(ctx, heat, f.dpr, b);
			else {
				fillRun(ctx, heat[BAND_FILL[runBand]], b);
				fills++;
			}
		}
		runBand = band;
		runStart = c;
	}
	return fills;
}

/** A bar's badge and name, drawn where they fit (9.4: "with the task's name when it fits"). */
function paintBarText(f: LanesFrame, bar: LaneBar, b: Box, name: string): number {
	const { ctx, theme } = f;
	let texts = 0;
	const badge = bar.textOnly && b.w >= BADGE + 2 * PAD;
	const room = b.w - 2 * PAD - (badge ? BADGE + 2 : 0);
	if (badge) {
		const x = b.x + b.w - BADGE - 4;
		roundedRect(ctx, x, b.y + (b.h - BADGE) / 2, BADGE, BADGE, 3);
		ctx.fillStyle = theme.textOnly;
		ctx.fill();
		ctx.fillStyle = theme.surface;
		ctx.textAlign = 'center';
		ctx.fillText(L.badge, x + BADGE / 2, b.y + b.h / 2 + 0.5);
		texts++;
	}
	if (room > 0 && textWidth(ctx, name) <= room) {
		ctx.fillStyle = bar.textOnly ? theme.text : theme.barInk;
		ctx.textAlign = 'left';
		ctx.fillText(name, b.x + PAD, b.y + b.h / 2 + 0.5);
		texts++;
	}
	ctx.textAlign = 'left';
	return texts;
}

/** One bar: a brass pill, or for a text-only task a faint dashed one. */
function paintBar(f: LanesFrame, bar: LaneBar, b: Box): void {
	const { ctx, theme, lane } = f;
	roundedRect(ctx, b.x, b.y, b.w, b.h, Math.min(lane.barRadius, b.w / 3));
	if (bar.textOnly) {
		ctx.globalAlpha = theme.textOnlyOpacity;
		ctx.fillStyle = theme.textOnly;
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.strokeStyle = theme.textOnly;
		ctx.lineWidth = theme.outlineWidth;
		ctx.setLineDash([theme.dash, theme.dash * 0.75]);
		ctx.stroke();
		ctx.setLineDash([]);
		return;
	}
	ctx.fillStyle = theme.barBottom;
	ctx.fill();
	ctx.strokeStyle = theme.barOutline;
	ctx.lineWidth = theme.barOutlineWidth;
	ctx.stroke();
}

export function paintLanes(f: LanesFrame): PaintStats {
	const { ctx, win, dpr, layout, lanes, heat, lane, theme } = f;
	let fills = 0;
	let texts = 0;
	begin(ctx, win, dpr);
	ctx.fillStyle = theme.surface;
	ctx.fillRect(win.x, win.y, win.w, win.h);
	fills++;
	const { r0, r1, c0, c1 } = layout.range(win, 0, 0);
	if (r1 <= r0 || c1 <= c0) return { fillRects: fills, texts };
	const axis = lanes.load.axis;
	const lo = layout.minuteAtX(axis, win.x);
	const hi = layout.minuteAtX(axis, win.x + win.w);
	// The hairlines first, one per column and per row, so that bars and names lie over them.
	ctx.fillStyle = theme.gridMinor;
	const top = layout.rowTop(r0);
	const bottom = layout.rowTop(r1);
	for (let c = c0; c <= c1; c++) {
		ctx.fillRect(c * layout.colWidth - 0.5, top, 1, bottom - top);
		fills++;
	}
	ctx.fillStyle = theme.rowLine;
	for (let r = r0; r <= r1; r++) {
		ctx.fillRect(c0 * layout.colWidth, layout.rowTop(r) - 0.5, (c1 - c0) * layout.colWidth, 1);
		fills++;
	}
	ctx.textBaseline = 'middle';
	ctx.font = `${theme.fontWeightBar} ${theme.fontSize}px ${theme.fontSans}`;
	for (let r = r0; r < r1; r++) {
		const row = lanes.load.rows[r];
		if (!row) continue;
		if (row.group) {
			const w = (c1 - c0) * layout.colWidth;
			fillRun(ctx, theme.inset, {
				x: c0 * layout.colWidth,
				y: layout.rowTop(r),
				w,
				h: layout.rowHeight,
			});
			fills++;
			fills += paintGroupBand(f, r, c0, c1);
			continue;
		}
		// Leave: hatched blocks behind the bars, a pattern per type.
		for (const l of lanes.leaves(r)) {
			const p = hatchPattern(ctx, HATCH_OF[l.type], heat.leaveHatch, dpr);
			if (!p) continue;
			const [a, z] = visibleRuns(l.runs, lo, hi);
			ctx.fillStyle = p;
			for (let k = a; k < z; k++) {
				const b = leaveBox(layout, axis, lane, r, l.runs[k] as { from: number; to: number });
				ctx.fillRect(b.x, b.y, b.w, b.h);
				fills++;
			}
		}
		// Bars, with their names where they fit.
		const runs = lanes.runs(r);
		const [a, z] = visibleRuns(runs, lo, hi);
		for (let k = a; k < z; k++) {
			const bar = runs[k] as LaneBar;
			const b = barBox(layout, axis, lane, r, bar);
			paintBar(f, bar, b);
			fills++;
			if (b.w >= BADGE + 2 * PAD) texts += paintBarText(f, bar, b, lanes.taskName(bar.task));
		}
		// The over strip: a red band at the foot of the lane, hatched, over the periods that are over.
		let start = -1;
		for (let c = c0; c <= c1; c++) {
			const over = c < c1 && lanes.load.band(r, c, f.thresholds) === 'over';
			if (over && start < 0) start = c;
			if (!over && start >= 0) {
				fills += fillOver(ctx, heat, dpr, overBox(layout, lane, r, start, c));
				start = -1;
			}
		}
	}
	return { fillRects: fills, texts };
}

export interface LanesOverlayFrame extends OverlayFrame {
	readonly lanes: LanesModel;
	readonly lane: LaneTheme;
	/** The bar under a mouse, and the bar lifted by a long-press or a drag in flight. */
	readonly hoverBar: { readonly row: number; readonly bar: LaneBar } | null;
	readonly liftedBar: { readonly row: number; readonly bar: LaneBar } | null;
	/** The task selected elsewhere (the Gantt, the text): its bars show a ring. */
	readonly selectedTask: string | null;
}

function ringBar(
	f: LanesOverlayFrame,
	row: number,
	bar: LaneBar,
	width: number,
	colour: string,
): void {
	const { ctx, layout, lanes, lane } = f;
	const b = barBox(layout, lanes.load.axis, lane, row, bar);
	roundedRect(ctx, b.x - 1, b.y - 1, b.w + 2, b.h + 2, Math.min(lane.barRadius + 1, (b.w + 2) / 3));
	ctx.strokeStyle = colour;
	ctx.lineWidth = width;
	ctx.stroke();
}

export function paintLanesOverlay(f: LanesOverlayFrame): void {
	// The heatmap's overlay does the lines, the period ring, the drag target and its label; the
	// lanes' own marks go on top of it.
	paintOverlay({ ...f, hover: null, lifted: null });
	const { ctx, win, layout, lanes, colours } = f;
	if (f.selectedTask !== null) {
		const { r0, r1 } = layout.range(win, 0, 0);
		const axis = lanes.load.axis;
		const lo = layout.minuteAtX(axis, win.x);
		const hi = layout.minuteAtX(axis, win.x + win.w);
		for (let r = r0; r < r1; r++) {
			const runs = lanes.runs(r);
			const [a, z] = visibleRuns(runs, lo, hi);
			for (let k = a; k < z; k++) {
				const bar = runs[k] as LaneBar;
				if (bar.task === f.selectedTask) ringBar(f, r, bar, 2, colours.accent);
			}
		}
	}
	if (f.hoverBar) ringBar(f, f.hoverBar.row, f.hoverBar.bar, 1.5, colours.text);
	if (f.liftedBar) {
		ctx.setLineDash([4, 3]);
		ringBar(f, f.liftedBar.row, f.liftedBar.bar, 2, colours.accent);
		ctx.setLineDash([]);
	}
}

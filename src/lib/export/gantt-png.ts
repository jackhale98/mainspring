// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt as a PNG (phase-4.md 18.20, T18): what the chart shows now, in the theme it is shown
 * in. No DOM screenshot: the picture is drawn with the painters the chart itself uses
 * (`gantt/paint/*`: the grid, the bars and links, the today and status lines, the time header) on
 * canvases of its own, at the screen's pixel ratio, and the task-name column beside them is laid
 * out by `png-frame.ts` (the task list on screen is DOM, so there is nothing to copy). The
 * selection tint, the hover rings and the handles are not drawn: they are state of the pointer,
 * not of the plan.
 *
 * Three canvases are drawn and one is composed: the plot (an off-screen canvas whose window is the
 * visible part of the content, exactly what `Timeline.svelte` paints), the header, and the picture
 * itself with the names and the two others placed on it. Nothing here is fetched until the first
 * export.
 *
 * The painters are handed in (`Painters`), not imported: the chart's first load has them already,
 * and a lazy chunk that imported them would make the bundler cut them out of the chunks a first
 * load fetches into shared chunks of their own, which costs every first load bytes (12.1).
 */
import type { Minutes } from '../../engine/protocol';
import type { GanttLayout } from '../gantt/layout';
import type { GanttModel } from '../gantt/model';
import type { paintBars } from '../gantt/paint/bars';
import type { PaintFrame } from '../gantt/paint/canvas';
import type { markerLines, paintGrid } from '../gantt/paint/grid';
import type { paintHeader } from '../gantt/paint/header';
import type { paintOverlay } from '../gantt/paint/overlay';
import type { Theme } from '../gantt/paint/theme';
import type { ticksFor, TickRows } from '../gantt/ticks';
import { frameSize, limitDpr, nameCells, type NameCell, type NameRow } from './png-frame';

/** The chart's own painters, from the chart's own modules. */
export interface Painters {
	readonly paintGrid: typeof paintGrid;
	readonly paintBars: typeof paintBars;
	readonly paintOverlay: typeof paintOverlay;
	readonly paintHeader: typeof paintHeader;
	readonly markerLines: typeof markerLines;
	readonly ticksFor: typeof ticksFor;
}

export interface GanttPngInput {
	readonly paint: Painters;
	readonly model: GanttModel;
	readonly layout: GanttLayout;
	readonly theme: Theme;
	readonly pxPerDay: number;
	/** The part of the content in view: its left and top, and the plot's visible size. */
	readonly scrollLeft: number;
	readonly scrollTop: number;
	readonly viewW: number;
	readonly viewH: number;
	/** The task-name column's width. */
	readonly namesW: number;
	/** The wall-clock minute of the today line (`todayOf`), or null. */
	readonly todayMin: Minutes | null;
	/** The pixel ratio of the picture (`exportDpr`). */
	readonly dpr: number;
	/** The name column's heading. */
	readonly heading: string;
}

const PAD = 12;
const INDENT = 16;
const ARROW = 14;

function canvasOf(doc: Document, w: number, h: number, dpr: number): HTMLCanvasElement {
	const c = doc.createElement('canvas');
	c.width = Math.round(w * dpr);
	c.height = Math.round(h * dpr);
	return c;
}

function contextOf(c: HTMLCanvasElement, opaque: boolean): CanvasRenderingContext2D {
	const ctx = c.getContext('2d', opaque ? { alpha: false } : undefined);
	if (!ctx) throw new Error('no 2d canvas');
	return ctx;
}

/**
 * The plot's three layers, each on a canvas of its own as on screen (a layer clears its canvas
 * before it paints, and the lines cut a gap in the bars layer's names): the grid, the bars with
 * their links, then the today and status lines.
 */
function drawPlot(
	doc: Document,
	i: GanttPngInput,
	dpr: number,
	ticks: TickRows | null,
): HTMLCanvasElement[] {
	const layer = (opaque: boolean): [HTMLCanvasElement, PaintFrame] => {
		const c = canvasOf(doc, i.viewW, i.viewH, dpr);
		return [
			c,
			{
				ctx: contextOf(c, opaque),
				win: { x: i.scrollLeft, y: i.scrollTop, w: i.viewW, h: i.viewH },
				dpr,
				layout: i.layout,
				model: i.model,
				theme: i.theme,
			},
		];
	};
	const [grid, g] = layer(true);
	i.paint.paintGrid(g, ticks, null);
	const [bars, b] = layer(false);
	i.paint.paintBars(b);
	const [lines, o] = layer(false);
	i.paint.paintOverlay(o, {
		selectedRow: null,
		hoverRow: null,
		hoverLink: null,
		todayMin: i.todayMin,
	});
	return [grid, bars, lines];
}

function drawHeader(
	c: HTMLCanvasElement,
	i: GanttPngInput,
	dpr: number,
	ticks: TickRows | null,
): void {
	const ctx = contextOf(c, true);
	if (!ticks) {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = i.theme.surfaceHeader;
		ctx.fillRect(0, 0, c.width, c.height);
		return;
	}
	i.paint.paintHeader({
		ctx,
		win: { x: i.scrollLeft, w: i.viewW },
		dpr,
		scale: i.layout.scale,
		ticks,
		markers: i.paint.markerLines(i.model, i.todayMin),
		theme: i.theme,
		viewLeft: i.scrollLeft,
	});
}

const nameFont = (t: Theme, bold: boolean): string =>
	`${bold ? t.fontWeightStrong : 'normal'} ${t.fontSize + 1.5}px ${t.fontSans}`;

/** The arrow of a container: a small triangle, down when open, right when closed. */
function drawArrow(ctx: CanvasRenderingContext2D, cell: NameCell, size: number): void {
	const cx = cell.arrowX + size / 2 + 1;
	const half = size / 2;
	ctx.beginPath();
	if (cell.arrow === 'open') {
		ctx.moveTo(cx - half, cell.y - half / 2);
		ctx.lineTo(cx + half, cell.y - half / 2);
		ctx.lineTo(cx, cell.y + half / 2 + 1);
	} else {
		ctx.moveTo(cx - half / 2, cell.y - half);
		ctx.lineTo(cx - half / 2, cell.y + half);
		ctx.lineTo(cx + half / 2 + 1, cell.y);
	}
	ctx.closePath();
	ctx.fill();
}

/** The name column: its surface, the heading over it and the rows' names. Drawn in CSS px. */
function drawNames(ctx: CanvasRenderingContext2D, i: GanttPngInput, dpr: number): void {
	const { theme: t, model, layout } = i;
	const headerH = layout.metrics.headerHeight;
	ctx.fillStyle = t.surface;
	ctx.fillRect(0, headerH, i.namesW, i.viewH);
	ctx.fillStyle = t.surfaceHeader;
	ctx.fillRect(0, 0, i.namesW, headerH);
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';
	ctx.font = `${t.headerMinorFontSize}px ${t.fontSans}`;
	ctx.fillStyle = t.textFaint;
	ctx.fillText(i.heading, PAD, headerH * 0.75 + 1);

	const rows: NameRow[] = model.rows.map((r) => ({
		name: r.name,
		depth: r.depth,
		kind: r.kind,
		expanded: r.expanded,
		context: r.context,
	}));
	const cells = nameCells(
		rows,
		{
			width: i.namesW,
			rowHeight: layout.metrics.rowHeight,
			scrollTop: i.scrollTop,
			viewH: i.viewH,
			headerH,
			pad: PAD,
			indent: INDENT,
			arrow: ARROW,
		},
		(text, bold) => {
			ctx.font = nameFont(t, bold);
			return ctx.measureText(text).width;
		},
	);
	ctx.save();
	// A row scrolled half under the header is cut at its edge, as on screen.
	ctx.beginPath();
	ctx.rect(0, headerH, i.namesW, i.viewH);
	ctx.clip();
	for (const c of cells) {
		if (c.arrow) {
			ctx.fillStyle = t.textMuted;
			drawArrow(ctx, c, 8);
		}
		if (c.text === '') continue;
		ctx.font = nameFont(t, c.bold);
		ctx.fillStyle = c.muted ? t.textFaint : t.text;
		ctx.fillText(c.text, c.x, c.y + 0.5);
	}
	ctx.restore();
	// The edges: under the header, and between the names and the plot.
	const hairline = 1 / dpr;
	ctx.fillStyle = t.border;
	ctx.fillRect(0, headerH - hairline, i.namesW, hairline);
	ctx.fillRect(i.namesW - hairline, 0, hairline, headerH + i.viewH);
}

/** Waits for the web fonts, so that the names are measured and drawn in the face the page shows. */
async function fontsReady(doc: Document): Promise<void> {
	try {
		await doc.fonts?.ready;
	} catch {
		// Drawn in the fallback face; still a picture.
	}
}

/** Empties a canvas's backing store. */
function release(c: HTMLCanvasElement): void {
	c.width = 0;
	c.height = 0;
}

/** The Gantt's visible range as a PNG. */
export async function renderGanttPng(i: GanttPngInput, doc: Document = document): Promise<Blob> {
	await fontsReady(doc);
	const headerH = i.layout.metrics.headerHeight;
	const dpr = limitDpr(i.namesW + i.viewW, headerH + i.viewH, i.dpr);
	const size = frameSize({ names: i.namesW, headerH, viewW: i.viewW, viewH: i.viewH, dpr });
	const cal = i.model.calendar;
	const { scale } = i.layout;
	const ticks = cal
		? i.paint.ticksFor(cal, scale.m(i.scrollLeft), scale.m(i.scrollLeft + i.viewW), i.pxPerDay)
		: null;

	const plot = drawPlot(doc, i, dpr, ticks);
	const header = canvasOf(doc, i.viewW, headerH, dpr);
	drawHeader(header, i, dpr, ticks);

	const out = doc.createElement('canvas');
	out.width = size.pxWidth;
	out.height = size.pxHeight;
	const ctx = contextOf(out, true);
	ctx.fillStyle = i.theme.surface;
	ctx.fillRect(0, 0, out.width, out.height);
	const left = Math.round(i.namesW * dpr);
	ctx.drawImage(header, left, 0);
	for (const layer of plot) ctx.drawImage(layer, left, Math.round(headerH * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	drawNames(ctx, i, dpr);
	// What is composed has no more use: give the backing stores back at once (Safari keeps a canvas's
	// memory until a collection, and a phone has little).
	for (const c of [header, ...plot]) release(c);

	return new Promise<Blob>((resolve, reject) => {
		out.toBlob((b) => {
			release(out);
			if (b) resolve(b);
			else reject(new Error('the picture could not be encoded'));
		}, 'image/png');
	});
}

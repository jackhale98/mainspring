// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The time header (phase-2.md 6.4; ADR-0009): two rows of cells from `ticksFor`. The upper row
 * has the months in the display serif, with the year after the name in italic and muted; the
 * labels stick to the left edge of the view while their cell is under it, so a month name stays
 * readable while the month scrolls by. The lower row has the days or weeks in the small sans, in
 * tabular figures, left in their cells and left out when a cell is too narrow for its label. The
 * today line gets a brass crown knob at the foot of the header, the status date a small marker.
 */
import type { Tick, TickRows } from '../ticks';
import type { TimeScale } from '../scale';
import { begin, fillTabular, roundedRect, snap, tabularWidth, textWidth } from './canvas';
import type { Marker } from './grid';
import type { Theme } from './theme';

export interface HeaderFrame {
	readonly ctx: CanvasRenderingContext2D;
	/** The painted x range, in content coordinates. */
	readonly win: { readonly x: number; readonly w: number };
	readonly dpr: number;
	readonly scale: TimeScale;
	readonly ticks: TickRows;
	readonly markers: readonly Marker[];
	readonly theme: Theme;
	/** The content x at the left edge of the viewport, for sticky labels. */
	readonly viewLeft: number;
}

/** A label of the form "March 2026": the month, then the year it should be set apart from. */
const MONTH_YEAR = /^(.*\S)\s+(\d{4})$/;

function cell(h: HeaderFrame, t: Tick): { x0: number; x1: number } {
	return { x0: h.scale.x(t.at), x1: h.scale.x(t.end) };
}

/** Draws a crown: a small brass knob with a lit top, on top of the today line. */
function drawCrown(h: HeaderFrame, x: number, bottom: number): void {
	const { ctx, theme } = h;
	const w = theme.crownWidth;
	const ht = theme.crownHeight;
	const left = x - w / 2;
	const top = bottom - ht;
	const g = ctx.createLinearGradient(0, top, 0, bottom);
	g.addColorStop(0, theme.crownTop);
	g.addColorStop(1, theme.today);
	roundedRect(ctx, left, top, w, ht, 3);
	ctx.fillStyle = g;
	ctx.fill();
	roundedRect(ctx, left + 0.5, top + 0.5, w - 1, ht - 1, 2.5);
	ctx.strokeStyle = theme.crownEdge;
	ctx.lineWidth = 1;
	ctx.stroke();
}

export function paintHeader(h: HeaderFrame): void {
	const { ctx, win, dpr, theme } = h;
	const row = theme.headerRow;
	const height = row * 2;
	const pad = theme.labelPad;
	begin(ctx, { x: win.x, y: 0, w: win.w, h: height }, dpr);
	ctx.fillStyle = theme.surfaceHeader;
	ctx.fillRect(win.x, 0, win.w, height);
	const hairline = 1 / dpr;
	const left = win.x - 1;
	const right = win.x + win.w + 1;
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';

	// Upper row: month and year, sticky.
	const display = `${theme.headerFontSize}px ${theme.fontDisplay}`;
	const italic = `italic ${display}`;
	for (const t of h.ticks.major) {
		const { x0, x1 } = cell(h, t);
		if (x1 < left || x0 > right) continue;
		const parts = MONTH_YEAR.exec(t.label);
		const name = parts?.[1] ?? t.label;
		const year = parts?.[2] ?? '';
		ctx.font = display;
		const nameW = textWidth(ctx, name);
		ctx.font = italic;
		const gap = year === '' ? 0 : textWidth(ctx, ' ') + 1;
		const yearW = year === '' ? 0 : textWidth(ctx, year);
		const w = nameW + gap + yearW;
		if (x1 - x0 < w + 2 * pad) continue;
		const x = Math.min(Math.max(x0 + pad, h.viewLeft + pad), x1 - pad - w);
		// Only a sliver of the cell is in view: a cut-off label would read as noise.
		if (x < h.viewLeft) continue;
		const y = row / 2 + 1;
		ctx.font = display;
		ctx.fillStyle = theme.text;
		ctx.fillText(name, x, y);
		if (year !== '') {
			ctx.font = italic;
			ctx.fillStyle = theme.textFaint;
			ctx.fillText(year, x + nameW + gap, y);
		}
	}

	// Lower row: the small sans in tabular figures, left in the cell, centred when tight.
	ctx.font = `${theme.headerMinorFontSize}px ${theme.fontSans}`;
	ctx.fillStyle = theme.textFaint;
	const spacing = theme.headerLetterSpacing;
	for (const t of h.ticks.minor) {
		const { x0, x1 } = cell(h, t);
		if (x1 < left || x0 > right) continue;
		const w = tabularWidth(ctx, t.label, spacing);
		if (w + 8 > x1 - x0) continue;
		const x = x0 + Math.min(pad, (x1 - x0 - w) / 2);
		fillTabular(ctx, t.label, x, row * 1.5 + 1, spacing);
	}

	// The bottom edge.
	ctx.fillStyle = theme.border;
	ctx.fillRect(win.x, height - hairline, win.w, hairline);

	for (const m of h.markers) {
		const x = h.scale.x(m.at);
		if (x < left - theme.crownWidth || x > right + theme.crownWidth) continue;
		if (m.kind === 'status') {
			ctx.fillStyle = theme.statusDate;
			ctx.beginPath();
			ctx.moveTo(x - theme.markerSize, height - hairline);
			ctx.lineTo(x + theme.markerSize, height - hairline);
			ctx.lineTo(x, height - hairline - theme.markerSize);
			ctx.closePath();
			ctx.fill();
		} else {
			drawCrown(h, snap(x, dpr), height - 3);
		}
	}
}

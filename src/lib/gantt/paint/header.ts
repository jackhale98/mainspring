// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The time header (phase-2.md 6.4): two rows of cells from `ticksFor`. The upper row's labels
 * stick to the left edge of the view while their cell is under it, so a month name stays readable
 * while the month scrolls by; the lower row's labels are centred in their cells and left out when
 * the cell is too narrow for them. The today and status-date lines get a small marker at the
 * foot of the header in their own colours.
 */
import type { TimeScale } from '../scale';
import type { Tick, TickRows } from '../ticks';
import { begin, snap, textWidth } from './canvas';
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

function cell(h: HeaderFrame, t: Tick): { x0: number; x1: number } {
	return { x0: h.scale.x(t.at), x1: h.scale.x(t.end) };
}

export function paintHeader(h: HeaderFrame): void {
	const { ctx, win, dpr, theme } = h;
	const row = theme.headerRow;
	const height = row * 2;
	const pad = theme.labelPad;
	begin(ctx, { x: win.x, y: 0, w: win.w, h: height }, dpr);
	ctx.fillStyle = theme.surfaceSunken;
	ctx.fillRect(win.x, 0, win.w, height);
	const hairline = 1 / dpr;
	const left = win.x - 1;
	const right = win.x + win.w + 1;

	// Upper row: sticky labels.
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';
	ctx.font = `${theme.fontWeightStrong} ${theme.headerFontSize}px ${theme.fontSans}`;
	for (const t of h.ticks.major) {
		const { x0, x1 } = cell(h, t);
		if (x1 < left || x0 > right) continue;
		ctx.fillStyle = theme.gridMajor;
		ctx.fillRect(snap(x0, dpr), 0, hairline, row);
		const w = textWidth(ctx, t.label);
		if (x1 - x0 < w + 2 * pad) continue;
		const x = Math.min(Math.max(x0 + pad, h.viewLeft + pad), x1 - pad - w);
		// Only a sliver of the cell is in view: a cut-off label would read as noise.
		if (x < h.viewLeft) continue;
		ctx.fillStyle = theme.text;
		ctx.fillText(t.label, x, row / 2 + 0.5);
	}

	// Lower row: centred labels.
	// Day and week numbers in the mono face: digits of equal width.
	ctx.font = `${theme.headerMinorFontSize}px ${theme.fontMono}`;
	ctx.textAlign = 'center';
	for (const t of h.ticks.minor) {
		const { x0, x1 } = cell(h, t);
		if (x1 < left || x0 > right) continue;
		ctx.fillStyle = theme.gridMinor;
		ctx.fillRect(snap(x0, dpr), row, hairline, row);
		if (textWidth(ctx, t.label) + 2 * pad > x1 - x0) continue;
		ctx.fillStyle = theme.textMuted;
		ctx.fillText(t.label, (x0 + x1) / 2, row * 1.5 + 0.5);
	}

	// Row divider and the bottom edge.
	ctx.fillStyle = theme.gridMinor;
	ctx.fillRect(win.x, row - hairline, win.w, hairline);
	ctx.fillStyle = theme.border;
	ctx.fillRect(win.x, height - hairline, win.w, hairline);

	for (const m of h.markers) {
		const x = h.scale.x(m.at);
		if (x < left - theme.markerSize || x > right + theme.markerSize) continue;
		ctx.fillStyle = m.kind === 'status' ? theme.statusDate : theme.today;
		ctx.beginPath();
		ctx.moveTo(x - theme.markerSize, height - hairline);
		ctx.lineTo(x + theme.markerSize, height - hairline);
		ctx.lineTo(x, height - hairline - theme.markerSize);
		ctx.closePath();
		ctx.fill();
	}
}

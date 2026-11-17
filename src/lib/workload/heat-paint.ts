// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's two canvas layers (phase-3.md 8.1), drawn in content coordinates over a window of
 * the content that moves with it, as the Gantt's layers are (gantt/paint/canvas.ts):
 *
 * - `paintCells`: the cells. Neighbouring cells of one band in a row are one `fillRect`, the over
 *   cells add a diagonal hatch and a corner mark (never colour alone, WCAG 1.4.1), leave is a
 *   stripe pattern over the working time it removes, one hairline per column and per row
 *   separates the cells, and the face (hours or percent) is drawn only where a cell is at least
 *   `MIN_TEXT_WIDTH` wide. Hatches are canvas patterns, so each is one fill. The count of fills is
 *   returned: the budget of 8.1 is 600 per frame.
 * - `paintOverlay`: what changes without a new model: the today and status-date lines, the hover
 *   outline, the selected cell, the 3 px focus ring, the lifted cell and the drag target with its
 *   label. It is redrawn on its own, so a tick of the clock or a pointer move never repaints cells.
 *
 * No layout reads and no DOM except the pattern tiles (a small canvas each, cached): everything a
 * frame needs is in the frame object.
 */
import { begin, roundedRect, snap, textWidth } from '../gantt/paint/canvas';
import { cellFace } from './heat-cell';
import type { Box, Cell, HeatLayout } from './heat-layout';
import type { HeatUnit } from './heat-prefs';
import { MIN_TEXT_WIDTH, type HeatTheme } from './heat-theme';
import type { Band, LoadModel, Thresholds } from './types';

type Ctx = CanvasRenderingContext2D;

export interface PaintStats {
	readonly fillRects: number;
	readonly texts: number;
}

export interface CellsFrame {
	readonly ctx: Ctx;
	/** The painted window, in content coordinates. */
	readonly win: Box;
	readonly dpr: number;
	readonly layout: HeatLayout;
	readonly model: LoadModel;
	readonly thresholds: Thresholds;
	readonly unit: HeatUnit;
	readonly heat: HeatTheme;
	/** The ground the cells sit on, which also draws the hairlines between them. */
	readonly surface: string;
	readonly fontSans: string;
}

const BANDS: readonly Band[] = ['off', 'spare', 'full', 'over'];
const FILL: readonly (keyof HeatTheme)[] = ['off', 'spare', 'full', 'over'];
const INK: readonly (keyof HeatTheme)[] = ['offInk', 'spareInk', 'fullInk', 'overInk'];
const OFF = 0;
const OVER = 3;
const codeOf = (b: Band): number => BANDS.indexOf(b);

/** The band code of every cell of the window being painted, row by row (reused between frames). */
let scratch = new Uint8Array(0);

const tiles = new Map<string, CanvasPattern | null>();
const TILE = 6;
const LEAVE_TILE = 5;

/** A repeating stripe tile, made once per kind, colour and ratio. Null where there is no canvas. */
function stripes(ctx: Ctx, kind: 'diagonal' | 'leave', colour: string, dpr: number) {
	const key = `${kind}|${colour}|${dpr}`;
	if (tiles.has(key)) return tiles.get(key) ?? null;
	let p: CanvasPattern | null = null;
	try {
		// Over is "/" lines on a 6 px tile; leave is "\" lines on a 5 px tile at less strength, so
		// the two never read as one another where a cell has both.
		const size = kind === 'diagonal' ? TILE : LEAVE_TILE;
		const c = document.createElement('canvas');
		c.width = Math.max(1, Math.round(size * dpr));
		c.height = Math.max(1, Math.round(size * dpr));
		const t = c.getContext('2d');
		if (t) {
			t.scale(dpr, dpr);
			t.strokeStyle = colour;
			t.lineWidth = kind === 'diagonal' ? 1.5 : 1.2;
			if (kind === 'leave') t.globalAlpha = 0.7;
			t.beginPath();
			// Seamless 45 degree lines: the main diagonal and the two corners it wraps into.
			const h = size / 2;
			if (kind === 'diagonal') {
				t.moveTo(0, size);
				t.lineTo(size, 0);
				t.moveTo(-h, h);
				t.lineTo(h, -h);
				t.moveTo(h, size + h);
				t.lineTo(size + h, h);
			} else {
				t.moveTo(0, 0);
				t.lineTo(size, size);
				t.moveTo(-h, h);
				t.lineTo(h, size + h);
				t.moveTo(h, -h);
				t.lineTo(size + h, h);
			}
			t.stroke();
			p = ctx.createPattern(c, 'repeat');
			// The tile is drawn at the device ratio; the frame's transform scales it again.
			p?.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
		}
	} catch {
		p = null;
	}
	tiles.set(key, p);
	return p;
}

/** The height of a cell's leave hatch: all of an off cell, else its share, 6 px to 40 % of the cell. */
export function leaveHeight(h: number, off: boolean, lost: number, available: number): number {
	if (lost <= 0) return 0;
	if (off) return h;
	return Math.min(h * 0.4, Math.max(6, Math.round((h * lost) / (lost + available))));
}

export function paintCells(f: CellsFrame): PaintStats {
	const { ctx, win, dpr, layout, model, heat } = f;
	let fills = 0;
	let texts = 0;
	begin(ctx, win, dpr);
	ctx.fillStyle = f.surface;
	ctx.fillRect(win.x, win.y, win.w, win.h);
	fills++;
	const { r0, r1, c0, c1 } = layout.range(win, 0, 0);
	if (r1 <= r0 || c1 <= c0) return { fillRects: fills, texts };
	const h = layout.rowHeight;
	const w = layout.colWidth;
	const n = c1 - c0;
	if (scratch.length < (r1 - r0) * n) scratch = new Uint8Array((r1 - r0) * n);
	const code = scratch;
	for (let r = r0; r < r1; r++) {
		const y = layout.rowTop(r);
		const base = (r - r0) * n;
		// Bands and fills, a run of one band in a row at a time.
		let runStart = c0;
		let runBand = -1;
		for (let c = c0; c <= c1; c++) {
			const band = c < c1 ? codeOf(model.band(r, c, f.thresholds)) : -1;
			if (c < c1) code[base + c - c0] = band;
			if (band === runBand) continue;
			if (runBand >= 0) {
				ctx.fillStyle = heat[FILL[runBand] as keyof HeatTheme] as string;
				ctx.fillRect(runStart * w, y, (c - runStart) * w, h);
				fills++;
			}
			runBand = band;
			runStart = c;
		}
		// Leave stripes and over hatches, per cell, each a pattern fill.
		const leave = model.leave[r];
		const available = model.available[r];
		for (let c = c0; c < c1; c++) {
			const band = code[base + c - c0] as number;
			const x = c * w;
			const lost = leave?.[c] ?? 0;
			if (lost > 0) {
				// The working time leave removes, as a hatched block at the foot of the cell: all of an
				// off cell, else its share of the cell (at least 6 px, at most 40 %).
				const sh = leaveHeight(h, band === OFF, lost, available?.[c] ?? 0);
				const p = stripes(ctx, 'leave', heat[INK[band] as keyof HeatTheme] as string, dpr);
				if (p) {
					ctx.fillStyle = p;
					ctx.fillRect(x, y + h - sh, w, sh);
					fills++;
				}
			}
			if (band === OVER) {
				const p = stripes(ctx, 'diagonal', heat.overHatch, dpr);
				if (p) {
					ctx.fillStyle = p;
					ctx.fillRect(x, y, w, h);
					fills++;
				}
				// The corner mark: a small triangle at the top right.
				const m = Math.min(10, h / 2, w / 2);
				ctx.fillStyle = heat.overInk;
				ctx.beginPath();
				ctx.moveTo(x + w - m, y);
				ctx.lineTo(x + w, y);
				ctx.lineTo(x + w, y + m);
				ctx.closePath();
				ctx.fill();
			}
		}
	}
	// The hairlines that make cells of a run.
	ctx.fillStyle = f.surface;
	const top = layout.rowTop(r0);
	const bottom = layout.rowTop(r1);
	for (let c = c0; c <= c1; c++) {
		ctx.fillRect(c * w - 1, top, 1, bottom - top);
		fills++;
	}
	for (let r = r0; r <= r1; r++) {
		ctx.fillRect(c0 * w, layout.rowTop(r) - 1, n * w, 1);
		fills++;
	}
	// The faces.
	if (w >= MIN_TEXT_WIDTH) {
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		let ink = '';
		let weight = '';
		for (let r = r0; r < r1; r++) {
			const wt = model.rows[r]?.group ? '600 ' : '';
			if (wt !== weight) {
				weight = wt;
				ctx.font = `${wt}${heat.fontSize}px ${f.fontSans}`;
			}
			const rowTop = layout.rowTop(r);
			const base = (r - r0) * n;
			for (let c = c0; c < c1; c++) {
				const b = code[base + c - c0] as number;
				if (b === OFF) continue;
				const booked = model.booked[r]?.[c] ?? 0;
				const available = model.available[r]?.[c] ?? 0;
				const percent = available > 0 ? (100 * booked) / available : null;
				const face = cellFace({ booked, available, percent, band: BANDS[b] as Band }, f.unit);
				const colour = heat[INK[b] as keyof HeatTheme] as string;
				if (colour !== ink) {
					ink = colour;
					ctx.fillStyle = colour;
				}
				// The face sits in the part of the cell that leave does not hatch.
				const free = h - leaveHeight(h, false, model.leave[r]?.[c] ?? 0, available);
				ctx.fillText(face, c * w + w / 2, rowTop + free / 2 + 0.5);
				texts++;
			}
		}
	}
	return { fillRects: fills, texts };
}

/** A line of the overlay: a minute's x on the content, and which line it is. */
export interface HeatLine {
	readonly x: number;
	readonly kind: 'today' | 'status' | 'both';
}

export interface DragMark {
	readonly target: Cell | null;
	readonly ok: boolean;
	readonly label: { readonly text: string; readonly x: number; readonly y: number } | null;
}

export interface OverlayFrame {
	readonly ctx: Ctx;
	readonly win: Box;
	readonly dpr: number;
	readonly layout: HeatLayout;
	readonly lines: readonly HeatLine[];
	readonly selected: Cell | null;
	/** The roving focus cell, ringed when the keyboard has it. */
	readonly focus: Cell | null;
	readonly hover: Cell | null;
	/** A cell lifted by a long-press or a drag in flight (its task is being moved). */
	readonly lifted: Cell | null;
	readonly drag: DragMark | null;
	readonly colours: {
		readonly accent: string;
		readonly accentText: string;
		readonly focus: string;
		readonly today: string;
		readonly status: string;
		readonly blocked: string;
		readonly text: string;
		readonly surface: string;
	};
	readonly markerWidth: number;
	readonly dash: number;
	readonly fontSans: string;
	readonly fontSize: number;
}

function ring(ctx: Ctx, b: Box, width: number, colour: string): void {
	ctx.strokeStyle = colour;
	ctx.lineWidth = width;
	ctx.strokeRect(b.x + width / 2, b.y + width / 2, b.w - width, b.h - width);
}

export function paintOverlay(f: OverlayFrame): void {
	const { ctx, win, dpr, layout, colours } = f;
	begin(ctx, win, dpr);
	// Today and status date: today solid, the status date dashed, one solid line when they meet.
	for (const l of f.lines) {
		if (l.x < win.x - 2 || l.x > win.x + win.w + 2) continue;
		const x0 = snap(l.x - f.markerWidth / 2, dpr);
		ctx.fillStyle = l.kind === 'status' ? colours.status : colours.today;
		const top = 0;
		const bottom = layout.height;
		if (l.kind === 'status') {
			const on = f.dash * 1.5;
			const step = f.dash * 2.5;
			for (let y = top; y < bottom; y += step) ctx.fillRect(x0, y, f.markerWidth, on);
		} else {
			ctx.fillRect(x0, top, f.markerWidth, bottom - top);
		}
	}
	if (f.hover) ring(ctx, layout.box(f.hover), 1.5, colours.text);
	if (f.selected) {
		const b = layout.box(f.selected);
		ring(ctx, b, 2, colours.accent);
	}
	if (f.lifted) {
		const b = layout.box(f.lifted);
		ctx.setLineDash([4, 3]);
		ring(ctx, b, 2, colours.accent);
		ctx.setLineDash([]);
	}
	if (f.drag?.target) {
		const b = layout.box(f.drag.target);
		ctx.fillStyle = f.drag.ok ? colours.accent : colours.blocked;
		ctx.globalAlpha = 0.18;
		ctx.fillRect(b.x, b.y, b.w, b.h);
		ctx.globalAlpha = 1;
		ring(ctx, b, 2, f.drag.ok ? colours.accent : colours.blocked);
	}
	if (f.focus) ring(ctx, layout.box(f.focus), 3, colours.focus);
	const label = f.drag?.label;
	if (label) {
		ctx.font = `600 ${f.fontSize}px ${f.fontSans}`;
		const tw = textWidth(ctx, label.text);
		const pad = 8;
		const w = tw + 2 * pad;
		const h = f.fontSize + 12;
		const x = Math.max(win.x + 4, Math.min(label.x + 12, win.x + win.w - w - 4));
		const y = Math.max(win.y + 4, label.y - h - 10);
		ctx.fillStyle = f.drag?.ok ? colours.accent : colours.blocked;
		roundedRect(ctx, x, y, w, h, h / 2);
		ctx.fill();
		ctx.fillStyle = colours.accentText;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.fillText(label.text, x + pad, y + h / 2 + 0.5);
	}
}

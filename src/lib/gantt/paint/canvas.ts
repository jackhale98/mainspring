// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Canvas plumbing shared by the layers (phase-2.md 8.1): the device pixel ratio, sizing, a
 * cached text measure and the shared frame type. The backing store is the CSS size times the
 * pixel ratio, capped at 2: on a 2.6x phone that saves about 40% of the fill with no visible loss
 * on bars and lines. Everything is drawn in content coordinates, so a layer sets one transform
 * (`begin`) and the painters never think about scroll or ratio.
 */
import type { GanttLayout, PaintWindow } from '../layout';
import type { GanttModel } from '../model';
import type { Theme } from './theme';

export const MAX_DPR = 2;

export function effectiveDpr(raw: number): number {
	return Math.min(MAX_DPR, Math.max(1, raw || 1));
}

/** Sizes a canvas to CSS pixels at a ratio. Returns true when the backing store changed. */
export function sizeCanvas(c: HTMLCanvasElement, w: number, h: number, dpr: number): boolean {
	const bw = Math.round(w * dpr);
	const bh = Math.round(h * dpr);
	const changed = c.width !== bw || c.height !== bh;
	if (changed) {
		c.width = bw;
		c.height = bh;
	}
	c.style.width = `${w}px`;
	c.style.height = `${h}px`;
	return changed;
}

/** Everything a layer needs to paint one frame. */
export interface PaintFrame {
	readonly ctx: CanvasRenderingContext2D;
	readonly win: PaintWindow;
	readonly dpr: number;
	readonly layout: GanttLayout;
	readonly model: GanttModel;
	readonly theme: Theme;
}

/** Clears the window and maps content coordinates onto the canvas. */
export function begin(ctx: CanvasRenderingContext2D, win: PaintWindow, dpr: number): void {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	ctx.setTransform(dpr, 0, 0, dpr, -win.x * dpr, -win.y * dpr);
}

/** `v` moved to the nearest device pixel, so a 1 device pixel line is sharp. */
export function snap(v: number, dpr: number): number {
	return Math.round(v * dpr) / dpr;
}

/** A closed rounded rectangle path (`roundRect` is missing from older browsers). */
export function roundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	const rad = Math.max(0, Math.min(r, w / 2, h / 2));
	ctx.beginPath();
	ctx.moveTo(x + rad, y);
	ctx.arcTo(x + w, y, x + w, y + h, rad);
	ctx.arcTo(x + w, y + h, x, y + h, rad);
	ctx.arcTo(x, y + h, x, y, rad);
	ctx.arcTo(x, y, x + w, y, rad);
	ctx.closePath();
}

const widths = new Map<string, number>();
const MAX_CACHED_WIDTHS = 4000;

/** Text width in CSS pixels for the context's current font, cached per font and text. */
export function textWidth(ctx: CanvasRenderingContext2D, text: string): number {
	const key = `${ctx.font}\u0000${text}`;
	const known = widths.get(key);
	if (known !== undefined) return known;
	if (widths.size >= MAX_CACHED_WIDTHS) widths.clear();
	const w = ctx.measureText(text).width;
	widths.set(key, w);
	return w;
}

/** Forgets measured widths, for when the fonts finished loading. */
export function clearTextCache(): void {
	widths.clear();
}

/** The label font: the bar-label size, or with `small` the size for text beside a bar. */
export const labelFont = (t: Theme, small = false): string =>
	`${small ? t.labelSize : t.fontSize}px ${t.fontSans}`;

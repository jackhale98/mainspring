// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Dependency lines (phase-2.md 8.1), drawn under the bars: routed paths from the predecessor's
 * start or end to the successor's start or end (finish to start, start to start, finish to
 * finish, start to finish), with rounded corners where there is room and a small open arrow head
 * along the last segment, a little short of the bar. Critical links are in the critical colour
 * and thicker (the thickness and the treegrid's critical column carry the meaning where colour
 * cannot, WCAG 1.4.1). A link only the engine knows is dashed; one the text declares but the
 * schedule does not show yet is dotted in the pending colour. Only links with a row in the painted
 * range are looked at, and the ones that share a style are stroked in one path.
 *
 * A frame allocates nothing here (phase-2.md 6.3): paths are routed into one scratch `PathBuf`,
 * and the arrow heads of a pass are kept in a typed array that only ever grows.
 */
import type { GanttLink } from '../model';
import { rowRange, type GanttLayout } from '../layout';
import { newPath, type PathBuf } from '../route';
import type { PaintFrame } from './canvas';
import type { Theme } from './theme';

type Style = 'normal' | 'engine' | 'pending' | 'critical';

function styleOf(l: GanttLink): Style {
	if (l.critical) return 'critical';
	return l.state === 'declared' ? 'normal' : l.state;
}

const path: PathBuf = newPath();
const dir = { dx: 0, dy: 0 };
/** Arrow heads of the pass being drawn: tip x, tip y, direction x, direction y. */
let heads = new Float64Array(256);

/** The unit direction of the last segment that has a length, into `dir`; false for a degenerate path. */
function arrival(p: PathBuf): boolean {
	for (let i = p.n - 1; i > 0; i--) {
		const dx = (p.xy[2 * i] ?? 0) - (p.xy[2 * i - 2] ?? 0);
		const dy = (p.xy[2 * i + 1] ?? 0) - (p.xy[2 * i - 1] ?? 0);
		const len = Math.hypot(dx, dy);
		if (len > 0.5) {
			dir.dx = dx / len;
			dir.dy = dy / len;
			return true;
		}
	}
	return false;
}

/**
 * Adds a polyline to the path with its corners rounded by quadratic curves. A corner's radius is
 * at most `radius`, and at most half of each segment beside it, so a short segment keeps a sharp
 * corner rather than a kink.
 */
export function roundedPolyline(ctx: CanvasRenderingContext2D, p: PathBuf, radius: number): void {
	const xy = p.xy;
	if (p.n === 0) return;
	ctx.moveTo(xy[0] ?? 0, xy[1] ?? 0);
	for (let i = 1; i < p.n; i++) {
		const px = xy[2 * i] ?? 0;
		const py = xy[2 * i + 1] ?? 0;
		if (i === p.n - 1) {
			ctx.lineTo(px, py);
			continue;
		}
		const ax = xy[2 * i - 2] ?? 0;
		const ay = xy[2 * i - 1] ?? 0;
		const nx = xy[2 * i + 2] ?? 0;
		const ny = xy[2 * i + 3] ?? 0;
		const inLen = Math.hypot(px - ax, py - ay);
		const outLen = Math.hypot(nx - px, ny - py);
		const r = Math.min(radius, inLen / 2, outLen / 2);
		if (r < 1) {
			ctx.lineTo(px, py);
			continue;
		}
		ctx.lineTo(px - ((px - ax) / inLen) * r, py - ((py - ay) / inLen) * r);
		ctx.quadraticCurveTo(px, py, px + ((nx - px) / outLen) * r, py + ((ny - py) / outLen) * r);
	}
}

/** Pulls the last point back `gap` along the last segment, in place. */
function shorten(p: PathBuf, gap: number): void {
	if (gap <= 0 || p.n < 2 || !arrival(p)) return;
	const last = 2 * (p.n - 1);
	p.xy[last] = (p.xy[last] ?? 0) - dir.dx * gap;
	p.xy[last + 1] = (p.xy[last + 1] ?? 0) - dir.dy * gap;
}

/** Adds the two strokes of an open arrow head with its tip at (x, y), pointing along (dx, dy). */
function addHead(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	dx: number,
	dy: number,
	size: number,
): void {
	const half = size * 0.7;
	const bx = x - dx * size;
	const by = y - dy * size;
	ctx.moveTo(bx - dy * half, by + dx * half);
	ctx.lineTo(x, y);
	ctx.lineTo(bx + dy * half, by - dx * half);
}

/**
 * Routes a link into the scratch path, pulled back by the link gap, ready to stroke; false when
 * a bar is missing. Shared by the base layer and the hovered link, so that they run on the very
 * same shortened, rounded path.
 */
export function routeShortened(layout: GanttLayout, link: GanttLink, theme: Theme): PathBuf | null {
	if (!layout.linkInto(link, path)) return null;
	shorten(path, theme.linkGap);
	return path;
}

/** Adds a link's line and its arrow head to the current path (the hovered link's stroke). */
export function traceLink(ctx: CanvasRenderingContext2D, p: PathBuf, theme: Theme): void {
	roundedPolyline(ctx, p, theme.linkRadius);
	if (!arrival(p)) return;
	const last = 2 * (p.n - 1);
	addHead(ctx, p.xy[last] ?? 0, p.xy[last + 1] ?? 0, dir.dx, dir.dy, theme.arrowSize);
}

export function paintLinks(f: PaintFrame): void {
	const { ctx, win, layout, model, theme } = f;
	const arrow = theme.arrowSize;
	const { first, last } = rowRange(layout, win.y, win.h, 0);
	const dashed = [theme.dash, theme.dash * 0.75];
	const dotted = [theme.linkWidth, theme.dash * 0.6];
	const passes: Array<[Style, string, number, number[]]> = [
		['normal', theme.link, theme.linkWidth, []],
		['engine', theme.link, theme.linkWidth, dashed],
		['pending', theme.pending, theme.linkWidth, dotted],
		['critical', theme.critical, theme.linkWidthCritical, []],
	];
	for (const [style, colour, width, dash] of passes) {
		let count = 0;
		let any = false;
		for (const link of model.links) {
			if (styleOf(link) !== style) continue;
			if (
				Math.max(link.predRow, link.succRow) < first ||
				Math.min(link.predRow, link.succRow) >= last
			) {
				continue;
			}
			if (!layout.linkInto(link, path)) continue;
			let minX = Infinity;
			let maxX = -Infinity;
			for (let i = 0; i < path.n; i++) {
				const x = path.xy[2 * i] ?? 0;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
			}
			if (maxX < win.x - arrow || minX > win.x + win.w + arrow) continue;
			if (!any) {
				ctx.strokeStyle = colour;
				ctx.lineWidth = width;
				ctx.lineJoin = 'round';
				ctx.lineCap = 'round';
				ctx.setLineDash(dash);
				ctx.beginPath();
				any = true;
			}
			shorten(path, theme.linkGap);
			roundedPolyline(ctx, path, theme.linkRadius);
			if (arrival(path)) {
				if (4 * (count + 1) > heads.length) {
					const grown = new Float64Array(heads.length * 2);
					grown.set(heads);
					heads = grown;
				}
				const end = 2 * (path.n - 1);
				heads[4 * count] = path.xy[end] ?? 0;
				heads[4 * count + 1] = path.xy[end + 1] ?? 0;
				heads[4 * count + 2] = dir.dx;
				heads[4 * count + 3] = dir.dy;
				count++;
			}
		}
		if (!any) continue;
		ctx.stroke();
		ctx.setLineDash([]);
		// Open arrow heads: two short strokes back from the tip.
		ctx.beginPath();
		for (let i = 0; i < count; i++) {
			addHead(
				ctx,
				heads[4 * i] ?? 0,
				heads[4 * i + 1] ?? 0,
				heads[4 * i + 2] ?? 0,
				heads[4 * i + 3] ?? 0,
				arrow,
			);
		}
		ctx.stroke();
	}
}

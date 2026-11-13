// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Dependency lines (phase-2.md 8.1), drawn under the bars: routed paths from the predecessor's
 * start or end to the successor's start or end (finish to start, start to start, finish to
 * finish, start to finish), with rounded corners where there is room and a small open arrow head
 * along the last segment, a little short of the bar. Critical links are blued steel and thicker
 * (the thickness and the treegrid's critical column carry the meaning where colour cannot, WCAG
 * 1.4.1). A link only the engine knows is dashed; one the text declares but the schedule does not
 * show yet is dotted in the pending colour. Only links with a row in the painted range are looked
 * at, and the ones that share a style are stroked in one path.
 */
import type { GanttLink } from '../model';
import { rowRange, type GanttLayout, type Point } from '../layout';
import type { PaintFrame } from './canvas';

type Style = 'normal' | 'engine' | 'pending' | 'critical';

function styleOf(l: GanttLink): Style {
	if (l.critical) return 'critical';
	return l.state === 'declared' ? 'normal' : l.state;
}

/** The unit direction of the last segment that has a length, or null for a degenerate path. */
function arrival(path: readonly Point[]): { dx: number; dy: number } | null {
	for (let i = path.length - 1; i > 0; i--) {
		const a = path[i - 1];
		const b = path[i];
		if (!a || !b) continue;
		const len = Math.hypot(b.x - a.x, b.y - a.y);
		if (len > 0.5) return { dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
	}
	return null;
}

/**
 * Adds a polyline to the path with its corners rounded by quadratic curves. A corner's radius is
 * at most `radius`, and at most half of each segment beside it, so a short segment keeps a sharp
 * corner rather than a kink.
 */
export function roundedPolyline(
	ctx: CanvasRenderingContext2D,
	path: readonly Point[],
	radius: number,
): void {
	const [head, ...rest] = path;
	if (!head) return;
	ctx.moveTo(head.x, head.y);
	for (let i = 0; i < rest.length; i++) {
		const p = rest[i];
		if (!p) continue;
		const prev = path[i];
		const next = rest[i + 1];
		if (!prev || !next) {
			ctx.lineTo(p.x, p.y);
			continue;
		}
		const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
		const outLen = Math.hypot(next.x - p.x, next.y - p.y);
		const r = Math.min(radius, inLen / 2, outLen / 2);
		if (r < 1) {
			ctx.lineTo(p.x, p.y);
			continue;
		}
		ctx.lineTo(p.x - ((p.x - prev.x) / inLen) * r, p.y - ((p.y - prev.y) / inLen) * r);
		ctx.quadraticCurveTo(
			p.x,
			p.y,
			p.x + ((next.x - p.x) / outLen) * r,
			p.y + ((next.y - p.y) / outLen) * r,
		);
	}
}

/** The path with its last point pulled back `gap` along the last segment. */
function shortened(path: readonly Point[], gap: number): readonly Point[] {
	const dir = arrival(path);
	const end = path[path.length - 1];
	if (!dir || !end || gap <= 0) return path;
	return [...path.slice(0, -1), { x: end.x - dir.dx * gap, y: end.y - dir.dy * gap }];
}

export function paintLinks(f: PaintFrame): void {
	const { ctx, win, layout, model, theme } = f;
	const arrow = theme.arrowSize;
	const half = arrow * 0.7;
	const { first, last } = rowRange(layout, win.y, win.h, 0);
	const visible: Array<{ link: GanttLink; path: ReturnType<GanttLayout['linkPath']> }> = [];
	for (const link of model.links) {
		const top = Math.min(link.predRow, link.succRow);
		const bottom = Math.max(link.predRow, link.succRow);
		if (bottom < first || top >= last) continue;
		const path = layout.linkPath(link);
		if (path.length < 2) continue;
		let minX = Infinity;
		let maxX = -Infinity;
		for (const p of path) {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
		}
		if (maxX < win.x - arrow || minX > win.x + win.w + arrow) continue;
		visible.push({ link, path: shortened(path, theme.linkGap) });
	}

	const dashed = [theme.dash, theme.dash * 0.75];
	const dotted = [theme.linkWidth, theme.dash * 0.6];
	const passes: Array<[Style, string, number, number[]]> = [
		['normal', theme.link, theme.linkWidth, []],
		['engine', theme.link, theme.linkWidth, dashed],
		['pending', theme.pending, theme.linkWidth, dotted],
		['critical', theme.critical, theme.linkWidthCritical, []],
	];
	for (const [style, colour, width, dash] of passes) {
		const mine = visible.filter((v) => styleOf(v.link) === style);
		if (mine.length === 0) continue;
		ctx.strokeStyle = colour;
		ctx.lineWidth = width;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.setLineDash(dash);
		ctx.beginPath();
		for (const { path } of mine) roundedPolyline(ctx, path, theme.linkRadius);
		ctx.stroke();
		ctx.setLineDash([]);
		// Open arrow heads: two short strokes back from the tip.
		ctx.beginPath();
		for (const { path } of mine) {
			const end = path[path.length - 1];
			const dir = arrival(path);
			if (!end || !dir) continue;
			const bx = end.x - dir.dx * arrow;
			const by = end.y - dir.dy * arrow;
			ctx.moveTo(bx - dir.dy * half, by + dir.dx * half);
			ctx.lineTo(end.x, end.y);
			ctx.lineTo(bx + dir.dy * half, by - dir.dx * half);
		}
		ctx.stroke();
	}
}

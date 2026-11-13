// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Dependency lines (phase-2.md 8.1), drawn under the bars: elbow paths from a predecessor's end
 * to a successor's start with an arrow head. Links on the critical path are red and thicker (the
 * thickness and the treegrid's critical column carry the meaning where colour cannot, WCAG
 * 1.4.1), links only the engine knows are dashed. Only links with a row in the painted range are
 * looked at, and the ones that share a style are stroked in one path.
 */
import type { GanttLink } from '../model';
import { rowRange, type GanttLayout } from '../layout';
import type { PaintFrame } from './canvas';

type Style = 'normal' | 'engine' | 'critical';

function styleOf(l: GanttLink): Style {
	return l.critical ? 'critical' : l.site === null ? 'engine' : 'normal';
}

export function paintLinks(f: PaintFrame): void {
	const { ctx, win, layout, model, theme } = f;
	const arrow = theme.arrowSize;
	const half = arrow * 0.58;
	const { first, last } = rowRange(layout, win.y, win.h, 0);
	const visible: Array<{ link: GanttLink; path: ReturnType<GanttLayout['linkPath']> }> = [];
	for (const link of model.links) {
		const top = Math.min(link.predRow, link.succRow);
		const bottom = Math.max(link.predRow, link.succRow);
		if (bottom < first || top >= last) continue;
		const path = layout.linkPath(link);
		if (path.length < 2) continue;
		const xs = path.map((p) => p.x);
		if (Math.max(...xs) < win.x - arrow || Math.min(...xs) > win.x + win.w) continue;
		visible.push({ link, path });
	}

	const passes: Array<[Style, string, number, number[]]> = [
		['normal', theme.link, theme.linkWidth, []],
		['engine', theme.link, theme.linkWidth, [theme.dash, theme.dash * 0.75]],
		['critical', theme.critical, theme.linkWidthCritical, []],
	];
	for (const [style, colour, width, dash] of passes) {
		const mine = visible.filter((v) => styleOf(v.link) === style);
		if (mine.length === 0) continue;
		ctx.strokeStyle = colour;
		ctx.fillStyle = colour;
		ctx.lineWidth = width;
		ctx.lineJoin = 'round';
		ctx.setLineDash(dash);
		ctx.beginPath();
		for (const { path } of mine) {
			const end = path[path.length - 1];
			const [head, ...rest] = path;
			if (!head || !end) continue;
			ctx.moveTo(head.x, head.y);
			for (const p of rest) ctx.lineTo(p.x, p.y);
		}
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.beginPath();
		for (const { path } of mine) {
			const end = path[path.length - 1];
			if (!end) continue;
			ctx.moveTo(end.x, end.y);
			ctx.lineTo(end.x - arrow, end.y - half);
			ctx.lineTo(end.x - arrow, end.y + half);
			ctx.closePath();
		}
		ctx.fill();
	}
}

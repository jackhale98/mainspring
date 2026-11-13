// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Hit testing (phase-2.md 6.4): what is under a pointer, from the same layout the painter uses.
 * A bar is hit on its drawn shape grown to the minimum target size (24 px, 44 px on a coarse
 * pointer, WCAG 2.5.8), a link within a few pixels of its path, and anything else in a row is an
 * empty hit that still names the row and the minute, so a tap anywhere in a row can select it.
 * Handles and the other parts of the later hit kinds (resize, link dot, progress) join here with
 * the gestures; read-only Gantt has the body only.
 */
import type { Minutes } from '../../engine/protocol';
import type { GanttLayout, Point } from './layout';
import type { GanttModel } from './model';

export type Hit =
	| { readonly kind: 'bar'; readonly row: number }
	| { readonly kind: 'link'; readonly link: number }
	| { readonly kind: 'empty'; readonly row: number | null; readonly at: Minutes };

function distanceToSegment(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distanceToPath(p: Point, path: readonly Point[]): number {
	let best = Infinity;
	for (let i = 1; i < path.length; i++) {
		const a = path[i - 1];
		const b = path[i];
		if (a && b) best = Math.min(best, distanceToSegment(p, a, b));
	}
	return best;
}

/** `x` and `y` are content coordinates (layout.ts). */
export function hitTest(layout: GanttLayout, model: GanttModel, x: number, y: number): Hit {
	const row = layout.rowAt(y);
	if (row !== null) {
		const r = layout.hitRect(row);
		if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
			return { kind: 'bar', row };
		}
	}
	const slop = layout.metrics.linkSlop;
	const p = { x, y };
	let nearest = -1;
	let nearestDistance = slop;
	for (let i = 0; i < model.links.length; i++) {
		const link = model.links[i];
		if (!link) continue;
		const top = layout.rowTop(Math.min(link.predRow, link.succRow)) - slop;
		const bottom = layout.rowTop(Math.max(link.predRow, link.succRow) + 1) + slop;
		if (y < top || y > bottom) continue;
		const d = distanceToPath(p, layout.linkPath(link));
		if (d <= nearestDistance) {
			nearest = i;
			nearestDistance = d;
		}
	}
	if (nearest >= 0) return { kind: 'link', link: nearest };
	return { kind: 'empty', row, at: Math.round(layout.scale.m(x)) };
}

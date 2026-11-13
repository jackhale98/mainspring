// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Hit testing (phase-2.md 6.4): what is under a pointer, from the same layout the painter uses.
 * A bar is hit on its drawn shape grown to the minimum target size (24 px, 44 px on a coarse
 * pointer, WCAG 2.5.8), a link within a few pixels of its path, and anything else in a row is an
 * empty hit that still names the row and the minute, so a tap anywhere in a row can select it.
 * A link is not hit over the avatars or the name beside a bar: the painter reports where it drew
 * the avatars and the layout knows where the names are (labels.ts), and the text wins over a line
 * that runs under it. Handles and the other parts of the later hit kinds
 * (resize, link dot, progress) join here with the gestures; read-only Gantt has the body only.
 *
 * `hitTest` runs on every pointer move and allocates nothing (phase-2.md 6.3): it reads the
 * layout's typed arrays through scratch objects.
 */
import type { Minutes } from '../../engine/protocol';
import { LABEL_STRIDE } from './labels';
import type { GanttLayout, MutableRect, Point } from './layout';
import type { GanttModel } from './model';
import { distanceToBuf, distanceToSegment, newPath, type PathBuf } from './route';

export type Hit =
	| { readonly kind: 'bar'; readonly row: number }
	| { readonly kind: 'link'; readonly link: number }
	| { readonly kind: 'empty'; readonly row: number | null; readonly at: Minutes };

export function distanceToPath(p: Point, path: readonly Point[]): number {
	let best = Infinity;
	for (let i = 1; i < path.length; i++) {
		const a = path[i - 1];
		const b = path[i];
		if (a && b) best = Math.min(best, distanceToSegment(p.x, p.y, a.x, a.y, b.x, b.y));
	}
	return best;
}

const scratchRect: MutableRect = { x: 0, y: 0, w: 0, h: 0 };
const scratchPath: PathBuf = newPath();

/** Whether a point is over the avatars drawn beside a row's bar. */
function overAvatars(layout: GanttLayout, row: number, x: number, y: number): boolean {
	const x0 = layout.avatars[2 * row];
	const x1 = layout.avatars[2 * row + 1];
	if (x0 === undefined || x1 === undefined || Number.isNaN(x0)) return false;
	const half = layout.metrics.rowHeight / 2;
	return x >= x0 && x <= x1 && Math.abs(y - (layout.rowTop(row) + half)) <= half;
}

/** Whether a point is over the name beside a row's bar (a name inside its bar is the bar's). */
function overName(layout: GanttLayout, row: number, x: number, y: number): boolean {
	const x0 = layout.labels[LABEL_STRIDE * row];
	const x1 = layout.labels[LABEL_STRIDE * row + 1];
	if (x0 === undefined || x1 === undefined || Number.isNaN(x0)) return false;
	if (layout.labels[LABEL_STRIDE * row + 2] !== 0) return false;
	const half = layout.metrics.rowHeight / 2;
	return x >= x0 && x <= x1 && Math.abs(y - (layout.rowTop(row) + half)) <= half;
}

/** `x` and `y` are content coordinates (layout.ts). */
export function hitTest(layout: GanttLayout, model: GanttModel, x: number, y: number): Hit {
	const row = layout.rowAt(y);
	if (row !== null) {
		const r = scratchRect;
		if (layout.hitInto(row, r) && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
			return { kind: 'bar', row };
		}
	}
	const slop = layout.metrics.linkSlop;
	let nearest = -1;
	let nearestDistance = slop;
	const skipLinks = row !== null && (overAvatars(layout, row, x, y) || overName(layout, row, x, y));
	for (let i = 0; !skipLinks && i < model.links.length; i++) {
		const link = model.links[i];
		if (!link) continue;
		const top = layout.rowTop(Math.min(link.predRow, link.succRow)) - slop;
		const bottom = layout.rowTop(Math.max(link.predRow, link.succRow) + 1) + slop;
		if (y < top || y > bottom) continue;
		if (!layout.linkInto(link, scratchPath)) continue;
		const d = distanceToBuf(x, y, scratchPath);
		if (d <= nearestDistance) {
			nearest = i;
			nearestDistance = d;
		}
	}
	if (nearest >= 0) return { kind: 'link', link: nearest };
	return { kind: 'empty', row, at: Math.round(layout.scale.m(x)) };
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where a dependency line runs (phase-2.md 6.4), in content coordinates, with no allocation: a
 * path is written into a `PathBuf` (up to six points as x, y pairs in a typed array) that the
 * caller keeps and reuses, so that hit testing on every pointer move and painting a frame do not
 * make garbage (phase-2.md 6.3). The layout wraps this for the model's links; the allocating
 * `pointsOf` is for tests and one-off callers.
 */

export interface Point {
	readonly x: number;
	readonly y: number;
}
export interface Rect {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}
/** A rectangle that a caller owns and fills in place, to avoid one allocation per bar. */
export interface MutableRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The most points a route has: the go-round shape (start, two bends each side, end). */
export const MAX_PATH_POINTS = 6;

/** A reusable path: `n` points, point `i` at `xy[2i]`, `xy[2i + 1]`. */
export interface PathBuf {
	n: number;
	readonly xy: Float64Array;
}

export const newPath = (): PathBuf => ({ n: 0, xy: new Float64Array(2 * MAX_PATH_POINTS) });

export function pointsOf(p: PathBuf): Point[] {
	const out: Point[] = [];
	for (let i = 0; i < p.n; i++) out.push({ x: p.xy[2 * i] ?? 0, y: p.xy[2 * i + 1] ?? 0 });
	return out;
}

function put(p: PathBuf, x: number, y: number): void {
	p.xy[2 * p.n] = x;
	p.xy[2 * p.n + 1] = y;
	p.n++;
}

export interface RouteEnds {
	readonly predRow: number;
	readonly succRow: number;
	readonly from: 'start' | 'end';
	readonly to: 'start' | 'end';
}

/**
 * Routes a link between two bars into `out` (cleared first). `elbow` is the room left of the first
 * bend, `rowHeight` places the row boundary that a path going back round runs along.
 */
export function routeLink(
	out: PathBuf,
	pred: Rect,
	succ: Rect,
	link: RouteEnds,
	predIsMilestone: boolean,
	elbow: number,
	rowHeight: number,
): void {
	out.n = 0;
	const x0 = link.from === 'end' ? pred.x + pred.w : pred.x;
	const y0 = pred.y + pred.h / 2;
	const x1 = link.to === 'start' ? succ.x : succ.x + succ.w;
	const y1 = succ.y + succ.h / 2;
	// The direction of travel leaving the predecessor and arriving at the successor.
	const d0 = link.from === 'end' ? 1 : -1;
	const d1 = link.to === 'start' ? 1 : -1;
	const down = link.succRow > link.predRow;

	// A milestone and a task that start at the same instant: a straight drop along the start
	// edge, not a loop round it.
	const centre = pred.x + pred.w / 2;
	if (predIsMilestone && link.to === 'start' && Math.abs(x1 - centre) <= elbow) {
		put(out, centre, down ? pred.y + pred.h : pred.y);
		put(out, centre, y1);
		return;
	}

	const a = x0 + d0 * elbow;
	const b = x1 - d1 * elbow;
	if (d0 !== d1) {
		// Both ends on the same side (end to end, start to start): one C-shaped bend.
		const m = d0 > 0 ? Math.max(a, b) : Math.min(a, b);
		put(out, x0, y0);
		put(out, m, y0);
		put(out, m, y1);
		put(out, x1, y1);
		return;
	}
	if ((x1 - a) * d1 >= 0) {
		put(out, x0, y0);
		put(out, a, y0);
		put(out, a, y1);
		put(out, x1, y1);
		return;
	}
	// The successor's end is behind the predecessor's: go round through the row boundary.
	const yMid = (down ? link.predRow + 1 : link.predRow) * rowHeight;
	put(out, x0, y0);
	put(out, a, y0);
	put(out, a, yMid);
	put(out, b, yMid);
	put(out, b, y1);
	put(out, x1, y1);
}

/** Distance from a point to the segment between two points. */
export function distanceToSegment(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
): number {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to a path (Infinity for a path of fewer than two points). */
export function distanceToBuf(px: number, py: number, p: PathBuf): number {
	let best = Infinity;
	for (let i = 1; i < p.n; i++) {
		const d = distanceToSegment(
			px,
			py,
			p.xy[2 * i - 2] ?? 0,
			p.xy[2 * i - 1] ?? 0,
			p.xy[2 * i] ?? 0,
			p.xy[2 * i + 1] ?? 0,
		);
		if (d < best) best = d;
	}
	return best;
}

/** A `PathBuf` of the given points (up to six), for tests and one-off callers. */
export function bufOf(points: readonly Point[]): PathBuf {
	const p = newPath();
	for (const q of points.slice(0, MAX_PATH_POINTS)) put(p, q.x, q.y);
	return p;
}

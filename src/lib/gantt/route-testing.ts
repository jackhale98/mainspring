// SPDX-License-Identifier: GPL-2.0-or-later
/** Builders for the route tests: bars on 28 px rows, a style, and a route as plain points. */
import {
	newPath,
	pointsOf,
	routeLink,
	type BarKind,
	type Point,
	type Rect,
	type RouteEnds,
	type RouteKinds,
	type RouteStyle,
} from './route';

export const ROW = 28;
export const H = 16;
/** An elbow and an inset of 8, rows of 28, and an arrow head of 5 that wants 4 more: approach 9. */
export const style: RouteStyle = {
	elbow: 8,
	rowHeight: ROW,
	approach: 9,
	runs: null,
	beside: null,
	inset: 8,
	stem: 5,
	cap: 2,
};
export const tasks: RouteKinds = { pred: 'task', succ: 'task' };
export const kindsOf = (pred: BarKind, succ: BarKind): RouteKinds => ({ pred, succ });

/** A bar of row `row` (rows are 28 tall, a bar of 16 is centred in one). */
export const barAt = (row: number, x: number, w: number, h = H): Rect => ({
	x,
	y: row * ROW + (ROW - h) / 2,
	w,
	h,
});
export const mid = (r: Rect): number => r.y + r.h / 2;
export const FS = { from: 'end', to: 'start' } as const;

export function route(
	pred: Rect,
	succ: Rect,
	predRow: number,
	succRow: number,
	kind: Pick<RouteEnds, 'from' | 'to'> = FS,
	kinds: RouteKinds = tasks,
	over: Partial<RouteStyle> = {},
): Point[] {
	const out = newPath();
	routeLink(out, pred, succ, { predRow, succRow, ...kind }, kinds, { ...style, ...over });
	return pointsOf(out);
}

export const last = (pts: Point[]): Point => pts[pts.length - 1] ?? { x: NaN, y: NaN };
export const orthogonal = (pts: Point[]): boolean =>
	pts.every((p, i) => i === 0 || p.x === pts[i - 1]?.x || p.y === pts[i - 1]?.y);
/** The length of the last segment, and whether it is vertical. */
export function lastRun(pts: Point[]): { len: number; vertical: boolean } {
	const a = pts[pts.length - 2];
	const b = last(pts);
	if (!a) return { len: 0, vertical: false };
	return { len: Math.hypot(b.x - a.x, b.y - a.y), vertical: a.x === b.x };
}

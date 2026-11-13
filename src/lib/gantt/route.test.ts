// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	MAX_PATH_POINTS,
	bufOf,
	distanceToBuf,
	distanceToSegment,
	newPath,
	pointsOf,
	routeLink,
	type Rect,
} from './route';

const pred: Rect = { x: 0, y: 10, w: 50, h: 16 };
const succ: Rect = { x: 100, y: 38, w: 50, h: 16 };
const ends = { predRow: 0, succRow: 1, from: 'end', to: 'start' } as const;
/** An elbow of 8, rows of 28, and an arrow head of 5 that wants 4 more: an approach of 9. */
const style = { elbow: 8, rowHeight: 28, approach: 9 };

describe('routeLink', () => {
	it('runs an elbow from the end of one bar to the start of the next, in one buffer', () => {
		const out = newPath();
		routeLink(out, pred, succ, ends, false, style);
		expect(pointsOf(out)).toEqual([
			{ x: 50, y: 18 },
			{ x: 58, y: 18 },
			{ x: 58, y: 46 },
			{ x: 100, y: 46 },
		]);
		// The buffer is reused: a second route overwrites it, whatever it held.
		routeLink(out, succ, pred, { ...ends, predRow: 1, succRow: 0 }, false, style);
		expect(out.n).toBeGreaterThan(1);
	});

	it('goes round through the row boundary when the successor starts behind', () => {
		const out = newPath();
		routeLink(out, { ...pred, x: 200 }, { ...succ, x: 10 }, ends, false, style);
		expect(out.n).toBe(MAX_PATH_POINTS);
		expect(out.xy[5]).toBe(28);
	});

	it('drops straight down from a milestone to a task that starts with it', () => {
		const out = newPath();
		const milestone: Rect = { x: 90, y: 8, w: 20, h: 20 };
		routeLink(out, milestone, { ...succ, x: 100 }, ends, true, style);
		expect(pointsOf(out)).toEqual([
			{ x: 100, y: 28 },
			{ x: 100, y: 46 },
		]);
	});
});

describe('the straight run into the target', () => {
	/** The length of the last segment of a path, and whether it runs along x. */
	const lastRun = (p: ReturnType<typeof newPath>): { len: number; horizontal: boolean } => {
		const pts = pointsOf(p);
		const a = pts[pts.length - 2];
		const b = pts[pts.length - 1];
		if (!a || !b) return { len: 0, horizontal: false };
		return { len: Math.hypot(b.x - a.x, b.y - a.y), horizontal: a.y === b.y };
	};

	it('never ends a finish-to-start link in a run shorter than the approach', () => {
		// The successor starts from far behind the predecessor's end to far past it: the target
		// sits in the elbow, at the line, just right of it, and clear of it.
		for (let dx = -60; dx <= 60; dx++) {
			for (const down of [true, false]) {
				const out = newPath();
				const p: Rect = { x: 100, y: down ? 10 : 66, w: 50, h: 16 };
				const q: Rect = { x: 150 + dx, y: down ? 66 : 10, w: 50, h: 16 };
				const rows = down ? { predRow: 0, succRow: 2 } : { predRow: 2, succRow: 0 };
				routeLink(out, p, q, { ...rows, from: 'end', to: 'start' }, false, style);
				const run = lastRun(out);
				expect(run.horizontal).toBe(true);
				expect(run.len).toBeGreaterThanOrEqual(style.approach);
			}
		}
	});

	it('steps in from left of a target that is just right of the line, instead of dropping beside it', () => {
		const out = newPath();
		// The line would drop at x 58; the target starts at 62, 4 px past it.
		routeLink(out, pred, { ...succ, x: 62 }, ends, false, style);
		const pts = pointsOf(out);
		expect(pts).toHaveLength(MAX_PATH_POINTS);
		// Down the row boundary, then in from approach px left of the target.
		expect(pts[3]).toEqual({ x: 62 - style.approach, y: 28 });
		expect(pts[5]).toEqual({ x: 62, y: 46 });
	});

	it('keeps the plain elbow when the run is long enough', () => {
		const out = newPath();
		routeLink(out, pred, { ...succ, x: 50 + 8 + 9 }, ends, false, style);
		expect(out.n).toBe(4);
	});

	it('keeps the approach into an end as well (finish to finish)', () => {
		const out = newPath();
		routeLink(out, pred, { ...succ, x: 20 }, { ...ends, to: 'end' }, false, style);
		const run = lastRun(out);
		expect(run.horizontal).toBe(true);
		expect(run.len).toBeGreaterThanOrEqual(style.approach);
	});
});

describe('distances', () => {
	it('measures to a segment and to a buffered path', () => {
		expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
		expect(distanceToSegment(13, 4, 0, 0, 10, 0)).toBe(5);
		expect(distanceToSegment(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2);
		const path = bufOf([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		]);
		expect(distanceToBuf(13, 5, path)).toBe(3);
		expect(distanceToBuf(0, 0, newPath())).toBe(Infinity);
	});
});

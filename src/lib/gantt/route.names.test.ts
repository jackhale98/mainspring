// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { Point } from './route';
import { FS, barAt, last, mid, route, tasks } from './route-testing';

/** Runs of rows: `[x0, x1, inside]` each, NaN for a row without one. */
const runsOf = (...rows: Array<[number, number, 0 | 1] | null>): Float64Array =>
	Float64Array.from(rows.flatMap((r) => r ?? [NaN, NaN, NaN]));

describe('names beside bars', () => {
	const p = barAt(0, 0, 50);
	/** Two rows down, starting at 120: the leg lands between 128 and 162. */
	const q = barAt(2, 120, 50);
	/** The x of the vertical leg of a three point path. */
	const legX = (pts: Point[]): number => pts[1]?.x ?? NaN;

	it('keeps its leg where it is when no name is in the way', () => {
		expect(legX(route(p, q, 0, 2, FS, tasks, { runs: runsOf(null, [200, 240, 0], null) }))).toBe(
			128,
		);
	});

	it('moves the leg past a name that a row between would have it run through', () => {
		const pts = route(p, q, 0, 2, FS, tasks, { runs: runsOf(null, [120, 140, 0], null) });
		expect(legX(pts)).toBe(143);
		expect(pts).toHaveLength(3);
		// Still on the successor's top edge.
		expect(last(pts)).toEqual({ x: 143, y: q.y });
	});

	it('does not move for a name inside a bar, which covers the line anyway', () => {
		expect(legX(route(p, q, 0, 2, FS, tasks, { runs: runsOf(null, [120, 140, 1], null) }))).toBe(
			128,
		);
	});

	it('stays put when a name spans the whole landing, and when no step off fits the bar', () => {
		// The leg may land from 128 to 162: a name from 120 to 170 covers all of it (170 + 3 is past
		// the bar), so the leg is not moved to somewhere worse.
		expect(legX(route(p, q, 0, 2, FS, tasks, { runs: runsOf(null, [120, 170, 0], null) }))).toBe(
			128,
		);
		expect(legX(route(p, q, 0, 2, FS, tasks, { runs: runsOf(null, [-10, 300, 0], null) }))).toBe(
			128,
		);
	});

	it('moves the leg of the route under the row boundary the same way', () => {
		const beside = Float64Array.from([64, Infinity, Infinity]);
		const pts = route(p, q, 0, 2, FS, tasks, { beside, runs: runsOf(null, [120, 140, 0], null) });
		expect(pts).toHaveLength(4);
		expect(pts[2]?.x).toBe(143);
		expect(pts[3]?.x).toBe(143);
	});

	it('moves the second leg of a go-round further back from the target', () => {
		const target = barAt(2, 30, 50);
		// The target starts behind the predecessor's end: down at 58, along the boundary, then down
		// at 30 - 9 = 21 past row 1, where a name sits from 10 to 40: the leg goes to 7.
		const pts = route(p, target, 0, 2, FS, tasks, { runs: runsOf(null, [10, 40, 0], null) });
		expect(pts[3]?.x).toBe(7);
		expect(pts[4]?.x).toBe(7);
	});
});

describe('a step-off never makes a run cross the own name of an end', () => {
	/** Whether a horizontal segment on `y` crosses the open interval (n0, n1). */
	const crosses = (pts: Point[], y: number, n0: number, n1: number): boolean =>
		pts.some((q, i) => {
			const a = pts[i - 1];
			if (i === 0 || !a || q.y !== y || a.y !== y) return false;
			return Math.max(Math.min(q.x, a.x), n0) < Math.min(Math.max(q.x, a.x), n1);
		});

	it('keeps every run clear of the own names of both ends whenever it was clear without steps', () => {
		for (const to of ['start', 'end'] as const) {
			for (const gap of [1, 2, 4]) {
				for (let sx = -40; sx <= 140; sx += 5) {
					for (let at = -10; at <= 90; at += 5) {
						const pred = barAt(0, 100, 40);
						const succ = barAt(gap, 100 + sx, 40);
						// Names beside both ends' bars (end + a gap of 14, 36 wide), and one on each row between.
						const rows: Array<[number, number, 0 | 1] | null> = [[154, 190, 0]];
						for (let r = 1; r < gap; r++) rows.push([100 + at, 136 + at, 0]);
						rows.push([succ.x + succ.w + 14, succ.x + succ.w + 50, 0]);
						const beside = Float64Array.from([154, ...rows.slice(1).map(() => Infinity)]);
						const link = { from: 'end', to } as const;
						const bare = route(pred, succ, 0, gap, link);
						const out = route(pred, succ, 0, gap, link, tasks, { runs: runsOf(...rows), beside });
						const ends: Array<[number, number, number]> = [
							[mid(pred), 154, 190],
							[mid(succ), succ.x + succ.w + 14, succ.x + succ.w + 50],
						];
						for (const [y, n0, n1] of ends) {
							if (!crosses(bare, y, n0, n1)) {
								expect(
									crosses(out, y, n0, n1),
									`to ${to}, ${gap} rows, succ at ${sx}, names at ${at}`,
								).toBe(false);
							}
						}
						// A finish to start link never runs through the predecessor's own name, bare or not.
						if (to === 'start') {
							expect(crosses(out, mid(pred), 154, 190), `to start, succ at ${sx}`).toBe(false);
						}
					}
				}
			}
		}
	});

	it('leaves the endpoint rows out of what a leg steps off', () => {
		// The predecessor's own name sits right where the leg would run (128): not a reason to move it.
		const p = barAt(0, 0, 50);
		const q = barAt(2, 120, 50);
		const pts = route(p, q, 0, 2, FS, tasks, {
			runs: runsOf([120, 160, 0], null, [180, 210, 0]),
		});
		expect(pts[1]?.x).toBe(128);
	});
});

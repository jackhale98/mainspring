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
	type BarKind,
	type Rect,
	type RouteEnds,
} from './route';
import {
	FS,
	ROW,
	barAt,
	kindsOf,
	last,
	lastRun,
	mid,
	orthogonal,
	route,
	style,
	tasks,
} from './route-testing';

describe('routeLink', () => {
	it('fills one reusable buffer: a second route overwrites whatever it held', () => {
		const out = newPath();
		const a = barAt(0, 0, 50);
		const b = barAt(1, 100, 50);
		routeLink(out, a, b, { predRow: 0, succRow: 1, ...FS }, tasks, style);
		const first = pointsOf(out);
		routeLink(out, b, a, { predRow: 1, succRow: 0, ...FS }, tasks, style);
		expect(out.n).toBe(MAX_PATH_POINTS);
		routeLink(out, a, b, { predRow: 0, succRow: 1, ...FS }, tasks, style);
		expect(pointsOf(out)).toEqual(first);
	});
});

describe('finish to start, the successor at or after the predecessor end', () => {
	const pred = barAt(0, 0, 50);

	it('runs along the end at mid-height and drops onto the successor top edge, inset from its start', () => {
		const succ = barAt(1, 100, 50);
		expect(route(pred, succ, 0, 1)).toEqual([
			{ x: 50, y: 14 },
			{ x: 108, y: 14 },
			{ x: 108, y: succ.y },
		]);
	});

	it('does the same for a successor directly under the end: no jog back, no second bend', () => {
		const succ = barAt(1, 50, 50);
		expect(route(pred, succ, 0, 1)).toEqual([
			{ x: 50, y: 14 },
			{ x: 58, y: 14 },
			{ x: 58, y: succ.y },
		]);
	});

	it('drops past the rows between to a successor far below', () => {
		const succ = barAt(5, 80, 40);
		expect(route(pred, succ, 0, 5)).toEqual([
			{ x: 50, y: 14 },
			{ x: 88, y: 14 },
			{ x: 88, y: succ.y },
		]);
	});

	it('runs up to the successor bottom edge when it is above', () => {
		const p = barAt(3, 0, 50);
		const succ = barAt(2, 70, 50);
		expect(route(p, succ, 3, 2)).toEqual([
			{ x: 50, y: mid(p) },
			{ x: 78, y: mid(p) },
			{ x: 78, y: succ.y + succ.h },
		]);
	});

	it('lands inside the bar by the inset, and in the middle of a bar shorter than two insets', () => {
		for (const [w, inset] of [
			[3, 1.5],
			[6, 3],
			[12, 6],
			[16, 8],
			[40, 8],
		] as const) {
			const succ = barAt(1, 90, w);
			expect(route(pred, succ, 0, 1)[1]?.x, `a bar of ${w}`).toBe(90 + inset);
		}
	});

	it('has an arrow head on the edge for every successor position, rows near and far, both ways', () => {
		for (let dx = 0; dx <= 60; dx++) {
			for (const [pRow, sRow] of [
				[0, 1],
				[0, 2],
				[0, 6],
				[6, 5],
				[6, 4],
				[6, 0],
			] as const) {
				const p = barAt(pRow, 200, 50);
				const q = barAt(sRow, 250 + dx, 50);
				const pts = route(p, q, pRow, sRow);
				const down = sRow > pRow;
				const edge = down ? q.y : q.y + q.h;
				const at = last(pts);
				const label = `dx ${dx}, row ${pRow} to ${sRow}`;
				// Out, then straight onto the edge: never a jog back, never past one bend.
				expect(orthogonal(pts), label).toBe(true);
				expect(pts.length, label).toBeLessThanOrEqual(3);
				expect(lastRun(pts).vertical, label).toBe(true);
				expect(Math.abs(at.y - edge), label).toBeLessThanOrEqual(0.5);
				expect(at.x, label).toBeGreaterThanOrEqual(q.x);
				expect(at.x, label).toBeLessThanOrEqual(q.x + q.w);
				pts.forEach((pt, i) => {
					const before = pts[i - 1];
					if (!before) return;
					expect(pt.x, label).toBeGreaterThanOrEqual(before.x);
					expect(down ? pt.y - before.y : before.y - pt.y, label).toBeGreaterThanOrEqual(0);
				});
			}
		}
	});

	it('has no jog for a successor that starts at the end or half a pixel before it', () => {
		for (const dx of [-0.5, -0.25, 0, 0.25]) {
			expect(route(pred, barAt(1, 50 + dx, 50), 0, 1), `dx ${dx}`).toHaveLength(3);
		}
	});
});

describe('finish to start, the successor starts before the end', () => {
	const pred = barAt(0, 100, 50);

	it('goes round: out a stub, down into the gap, back past the start, down, then in', () => {
		const succ = barAt(1, 90, 50);
		expect(route(pred, succ, 0, 1)).toEqual([
			{ x: 150, y: 14 },
			{ x: 158, y: 14 },
			{ x: 158, y: ROW },
			{ x: 81, y: ROW },
			{ x: 81, y: mid(succ) },
			{ x: 90, y: mid(succ) },
		]);
	});

	it('ends in a run of the approach into the start edge, pointing right, from a hair to far behind', () => {
		for (let dx = -200; dx < -1; dx++) {
			for (const down of [true, false]) {
				const p = barAt(down ? 0 : 3, 300, 50);
				const q = barAt(down ? 3 : 0, 350 + dx, 50);
				const pts = route(p, q, down ? 0 : 3, down ? 3 : 0);
				const run = lastRun(pts);
				expect(pts, `dx ${dx}`).toHaveLength(MAX_PATH_POINTS);
				expect(orthogonal(pts)).toBe(true);
				expect(run.vertical).toBe(false);
				expect(run.len).toBeGreaterThanOrEqual(style.approach);
				expect(last(pts)).toEqual({ x: q.x, y: mid(q) });
				// Through the row boundary next to the predecessor.
				expect(pts[2]?.y).toBe((down ? 1 : 3) * ROW);
			}
		}
	});

	it('goes round from a hair before the end, and goes direct from half a pixel before it', () => {
		expect(route(barAt(0, 0, 50), barAt(1, 48, 50), 0, 1)).toHaveLength(MAX_PATH_POINTS);
		expect(route(barAt(0, 0, 50), barAt(1, 49.6, 50), 0, 1)).toHaveLength(3);
	});

	it('drops from the bottom tip of a milestone to a tiny task at its instant, landing in its middle', () => {
		const ms = barAt(0, 100, 16);
		const succ = barAt(1, 108, 6);
		// The diamond's tip is at 116 and the 6 wide task starts at its instant: no room for a run
		// at mid-height, so the line leaves by the tip below and steps over 3 px.
		expect(route(ms, succ, 0, 1, FS, kindsOf('milestone', 'task'))).toEqual([
			{ x: 108, y: ms.y + 16 },
			{ x: 108, y: ROW },
			{ x: 111, y: ROW },
			{ x: 111, y: succ.y },
		]);
	});
});

describe('milestones and containers', () => {
	const ms = (row: number, cx: number): Rect => barAt(row, cx - 8, 16);

	it('lands on the vertex of a diamond, from above and from below', () => {
		const pred = barAt(0, 0, 50);
		const down = route(pred, ms(2, 90), 0, 2, FS, kindsOf('task', 'milestone'));
		expect(last(down)).toEqual({ x: 90, y: ms(2, 90).y });
		expect(lastRun(down).vertical).toBe(true);
		const p = barAt(4, 0, 50);
		const up = route(p, ms(2, 90), 4, 2, FS, kindsOf('task', 'milestone'));
		expect(last(up)).toEqual({ x: 90, y: ms(2, 90).y + 16 });
	});

	it('drops straight onto a milestone at the end of a task, with no bend at all', () => {
		const pred = barAt(0, 0, 50);
		const pts = route(pred, ms(1, 50), 0, 1, FS, kindsOf('task', 'milestone'));
		expect(pts).toEqual([
			{ x: 50, y: 14 },
			{ x: 50, y: ms(1, 50).y },
		]);
	});

	it('runs from the right tip of a milestone, and drops straight from its bottom for one at the same instant', () => {
		const m = ms(0, 40);
		const after = route(m, barAt(1, 100, 50), 0, 1, FS, kindsOf('milestone', 'task'));
		expect(after[0]).toEqual({ x: 48, y: 14 });
		const same = route(m, ms(1, 40), 0, 1, FS, kindsOf('milestone', 'milestone'));
		expect(same).toEqual([
			{ x: 40, y: m.y + 16 },
			{ x: 40, y: ms(1, 40).y },
		]);
	});

	it('treats a start to start link out of a milestone like a finish to start one', () => {
		const m = ms(0, 40);
		const succ = barAt(1, 100, 50);
		const ss = route(m, succ, 0, 1, { from: 'start', to: 'start' }, kindsOf('milestone', 'task'));
		expect(ss).toEqual(route(m, succ, 0, 1, FS, kindsOf('milestone', 'task')));
	});

	it('hooks out of a milestone to a task that starts at its instant, and lands on the task top edge', () => {
		const m = ms(0, 40);
		const succ = barAt(1, 40, 60);
		const pts = route(m, succ, 0, 1, FS, kindsOf('milestone', 'task'));
		expect(pts).toEqual([
			{ x: 48, y: 14 },
			{ x: 52, y: 14 },
			{ x: 52, y: succ.y },
		]);
	});

	it('lands a hair inside the cap of a summary bracket, on its top, and under its top bar from below', () => {
		const pred = barAt(0, 0, 50);
		const bracket = (row: number): Rect => barAt(row, 90, 80, 9);
		const down = route(pred, bracket(2), 0, 2, FS, kindsOf('task', 'container'));
		expect(last(down)).toEqual({ x: 91, y: bracket(2).y });
		const p = barAt(4, 0, 50);
		const up = route(p, bracket(2), 4, 2, FS, kindsOf('task', 'container'));
		// The bracket's top bar is 5 thick: the head ends under it, between the caps.
		expect(last(up)).toEqual({ x: 91, y: bracket(2).y + 5 });
	});

	it('leaves a bracket by its end at mid-height', () => {
		const bracket = barAt(0, 0, 80, 9);
		const pts = route(bracket, barAt(1, 120, 40), 0, 1, FS, kindsOf('container', 'task'));
		expect(pts[0]).toEqual({ x: 80, y: mid(bracket) });
	});
});

describe('what stands beside the predecessor', () => {
	const pred = barAt(0, 0, 50);
	/** The things beside row 0's bar begin at 64 (the end, 14 on). */
	const beside = Float64Array.from([64, Infinity, Infinity]);

	it('keeps the direct route while its run ends before the things beside the bar', () => {
		const succ = barAt(1, 50, 50);
		expect(route(pred, succ, 0, 1, FS, tasks, { beside })).toHaveLength(3);
	});

	it('leaves by the lower edge, near the end, and runs along the row boundary when they are in the way', () => {
		const succ = barAt(1, 120, 50);
		expect(route(pred, succ, 0, 1, FS, tasks, { beside })).toEqual([
			{ x: 42, y: pred.y + pred.h },
			{ x: 42, y: ROW },
			{ x: 128, y: ROW },
			{ x: 128, y: succ.y },
		]);
	});

	it('leaves by the upper edge for a successor above', () => {
		const p = barAt(2, 0, 50);
		const succ = barAt(1, 120, 50);
		const pts = route(p, succ, 2, 1, FS, tasks, { beside: Float64Array.from([NaN, NaN, 64]) });
		expect(pts).toEqual([
			{ x: 42, y: p.y },
			{ x: 42, y: 2 * ROW },
			{ x: 128, y: 2 * ROW },
			{ x: 128, y: succ.y + succ.h },
		]);
	});

	it('leaves a milestone by its bottom tip', () => {
		const m = barAt(0, 32, 16);
		const succ = barAt(1, 120, 50);
		const pts = route(m, succ, 0, 1, FS, kindsOf('milestone', 'task'), {
			beside: Float64Array.from([62, Infinity]),
		});
		expect(pts[0]).toEqual({ x: 40, y: m.y + 16 });
		expect(pts).toHaveLength(4);
	});

	it('does not mind a row with nothing beside it', () => {
		const succ = barAt(1, 120, 50);
		expect(route(pred, succ, 0, 1, FS, tasks, { beside: Float64Array.from([Infinity]) })).toEqual(
			route(pred, succ, 0, 1),
		);
	});
});

describe('start to start, finish to finish and start to finish', () => {
	const kinds: Array<[string, Pick<RouteEnds, 'from' | 'to'>]> = [
		['start to start', { from: 'start', to: 'start' }],
		['finish to finish', { from: 'end', to: 'end' }],
		['start to finish', { from: 'start', to: 'end' }],
	];
	const targets: Array<[string, (row: number, x: number) => Rect, BarKind]> = [
		['a task', (row, x) => barAt(row, x, 50), 'task'],
		['a tiny task', (row, x) => barAt(row, x, 3), 'task'],
		['a milestone', (row, x) => barAt(row, x, 16), 'milestone'],
		['a bracket', (row, x) => barAt(row, x, 50, 9), 'container'],
	];

	it('end on the edge they point at, along a run of the approach, whatever the target is', () => {
		for (const [name, kind] of kinds) {
			for (const [what, make, bar] of targets) {
				for (let dx = -80; dx <= 80; dx += 4) {
					for (const [pRow, sRow] of [
						[0, 1],
						[0, 3],
						[4, 3],
						[4, 1],
					] as const) {
						const p = barAt(pRow, 200, 50);
						const q = make(sRow, 230 + dx);
						const pts = route(p, q, pRow, sRow, kind, kindsOf('task', bar));
						const label = `${name} to ${what}, dx ${dx}, rows ${pRow} to ${sRow}`;
						const edgeX = kind.to === 'start' ? q.x : q.x + q.w;
						expect(orthogonal(pts), label).toBe(true);
						expect(last(pts), label).toEqual({ x: edgeX, y: mid(q) });
						expect(lastRun(pts).vertical, label).toBe(false);
						expect(lastRun(pts).len, label).toBeGreaterThanOrEqual(style.approach);
						expect(pts[0]?.x, label).toBe(kind.from === 'start' ? p.x : p.x + p.w);
						expect(pts[0]?.y, label).toBe(mid(p));
					}
				}
			}
		}
	});

	it('runs start to start and finish to finish round the outer side with one bend', () => {
		const a = barAt(0, 96, 96);
		const b = barAt(1, 144, 96);
		expect(route(a, b, 0, 1, { from: 'start', to: 'start' })).toEqual([
			{ x: 96, y: 14 },
			{ x: 88, y: 14 },
			{ x: 88, y: 42 },
			{ x: 144, y: 42 },
		]);
		expect(route(a, b, 0, 1, { from: 'end', to: 'end' })).toEqual([
			{ x: 192, y: 14 },
			{ x: 249, y: 14 },
			{ x: 249, y: 42 },
			{ x: 240, y: 42 },
		]);
	});

	it('runs start to finish round the start and back past the end when the end is behind it', () => {
		const a = barAt(0, 96, 96);
		const b = barAt(1, 144, 96);
		expect(route(a, b, 0, 1, { from: 'start', to: 'end' })).toEqual([
			{ x: 96, y: 14 },
			{ x: 88, y: 14 },
			{ x: 88, y: ROW },
			{ x: 249, y: ROW },
			{ x: 249, y: 42 },
			{ x: 240, y: 42 },
		]);
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

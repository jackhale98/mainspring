// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distanceToPath, hitTest } from './hit';
import { createLayout } from './layout';
import type { GanttRow } from './model';
import { createScale } from './scale';
import { D, FIXED_MEASURE, link, metricsOf, modelOf, row } from './testing';

const scale = createScale(48, 0);
const fine = metricsOf(false);

describe('hitTest', () => {
	const model = modelOf(
		[row(0, 0, 2 * D), row(1, 2 * D, 5 * D), row(2, null, null), row(3, 6 * D, 6 * D, 'milestone')],
		[link(0, 1)],
	);
	const layout = createLayout(model, scale, fine);

	it('hits the bar under the pointer', () => {
		expect(hitTest(layout, model, 40, 14)).toEqual({ kind: 'bar', row: 0 });
		expect(hitTest(layout, model, 150, 42)).toEqual({ kind: 'bar', row: 1 });
		expect(hitTest(layout, model, 6 * 48, 3 * 28 + 14)).toEqual({ kind: 'bar', row: 3 });
	});

	it('names the row and the minute for a hit beside a bar, and for an unscheduled row', () => {
		expect(hitTest(layout, model, 500, 14)).toEqual({ kind: 'empty', row: 0, at: 500 * 30 });
		const unscheduled = hitTest(layout, model, 100, 2 * 28 + 10);
		expect(unscheduled).toMatchObject({ kind: 'empty', row: 2 });
		expect(hitTest(layout, model, 100, 999)).toMatchObject({ kind: 'empty', row: null });
	});

	it('hits a link near its path but gives a bar the priority', () => {
		const path = layout.linkPath(model.links[0]!);
		// The vertical leg of the elbow, between the rows, outside both bars' hit areas.
		const leg = path[1]!;
		const onLeg = hitTest(layout, model, leg.x, 28);
		expect(onLeg).toEqual({ kind: 'link', link: 0 });
		expect(hitTest(layout, model, leg.x + 30, 28)).toMatchObject({ kind: 'empty' });
	});

	it('leaves links out of the avatars beside a bar: an avatar wins over the line under it', () => {
		const path = layout.linkPath(model.links[0]!);
		const leg = path[1]!;
		const fresh = createLayout(model, scale, fine);
		// Row 1's avatars sit on the leg's x, where row 0's link runs down into row 1.
		expect(hitTest(fresh, model, leg.x, 29)).toEqual({ kind: 'link', link: 0 });
		fresh.avatars[2] = leg.x - 10;
		fresh.avatars[3] = leg.x + 30;
		expect(hitTest(fresh, model, leg.x, 29)).toMatchObject({ kind: 'empty', row: 1 });
		// Other rows and the other side of the avatars are as before.
		expect(hitTest(fresh, model, leg.x, 28 - 6)).toEqual({ kind: 'link', link: 0 });
		expect(hitTest(fresh, model, leg.x + 60, 29)).toMatchObject({ kind: 'empty' });
	});

	it('leaves links out of the name beside a short bar, but not out of a name inside its bar', () => {
		const names = modelOf(
			[row(0, 0, 2 * D), row(1, 4 * D, 4 * D + 12), row(2, 6 * D, 7 * D)],
			[link(0, 2)],
		);
		const l = createLayout(names, scale, fine, 0, FIXED_MEASURE);
		// The link's leg runs down at x 104, past row 1, whose name is far to the right.
		const leg = l.linkPath(names.links[0]!)[1]!;
		expect(leg.x).toBe(104);
		expect(hitTest(l, names, leg.x, 42)).toEqual({ kind: 'link', link: 0 });
		// Put the name under the leg: it wins over the line.
		expect(l.labels[5]).toBe(0);
		l.labels[3] = leg.x - 10;
		l.labels[4] = leg.x + 30;
		expect(hitTest(l, names, leg.x, 42)).toMatchObject({ kind: 'empty', row: 1 });
		// A name inside its bar is the bar's own: the link is hit as before.
		l.labels[5] = 1;
		expect(hitTest(l, names, leg.x, 42)).toEqual({ kind: 'link', link: 0 });
	});

	it('does not allocate per call: a pointer move makes no garbage', () => {
		// The same two objects come back from the layout's scratch: only the result is new.
		const a = { x: 0, y: 0, w: 0, h: 0 };
		expect(layout.hitInto(0, a)).toBe(true);
		expect(layout.hitInto(2, a)).toBe(false);
		const before = process.memoryUsage().heapUsed;
		for (let i = 0; i < 20000; i++) hitTest(layout, model, 40 + (i % 50), 14 + (i % 30));
		// Generous bound: a result object per call is tens of bytes, not hundreds of kilobytes.
		expect(process.memoryUsage().heapUsed - before).toBeLessThan(4_000_000);
	});

	it('widens a short bar to the minimum target size', () => {
		const tiny = modelOf([row(0, 0, 10)]);
		const l = createLayout(tiny, scale, fine);
		expect(hitTest(l, tiny, 11, 14)).toEqual({ kind: 'bar', row: 0 });
		expect(hitTest(l, tiny, 40, 14)).toMatchObject({ kind: 'empty' });
		const coarse = createLayout(tiny, scale, metricsOf(true));
		expect(hitTest(coarse, tiny, 21, 20)).toEqual({ kind: 'bar', row: 0 });
	});
});

describe('distanceToPath', () => {
	it('measures to the nearest segment, and handles a degenerate one', () => {
		const path = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		];
		expect(distanceToPath({ x: 5, y: 3 }, path)).toBe(3);
		expect(distanceToPath({ x: 13, y: 5 }, path)).toBe(3);
		expect(
			distanceToPath({ x: 3, y: 4 }, [
				{ x: 0, y: 0 },
				{ x: 0, y: 0 },
			]),
		).toBe(5);
		expect(distanceToPath({ x: 0, y: 0 }, [])).toBe(Infinity);
	});
});

describe('painted pixel property', () => {
	const rowArb = fc
		.tuple(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 60 }), fc.boolean())
		.map(([start, len, milestone]): [number, number, GanttRow['kind']] => [
			start * D,
			(start + len) * D,
			milestone ? 'milestone' : len > 20 ? 'container' : 'task',
		]);

	it.each([false, true])(
		'the hit at any pixel of a drawn bar is that bar (coarse: %s)',
		(coarse) => {
			fc.assert(
				fc.property(
					fc.array(rowArb, { minLength: 1, maxLength: 40 }),
					fc.integer({ min: 1, max: 90 }),
					(specs, pxPerDay) => {
						const rows = specs.map(([s, e, k], i) => row(i, s, k === 'milestone' ? s : e, k));
						const m = modelOf(rows);
						const l = createLayout(m, createScale(pxPerDay, 0), metricsOf(coarse));
						rows.forEach((_, i) => {
							const bar = l.barRect(i);
							if (!bar) return;
							// Sample the corners, edges' insides and the centre of the drawn shape.
							const xs = [bar.x + 0.5, bar.x + bar.w / 2, bar.x + bar.w - 0.5];
							const ys = [bar.y + 0.5, bar.y + bar.h / 2, bar.y + bar.h - 0.5];
							for (const x of xs) {
								for (const y of ys) {
									// A diamond's corners are not painted: only test its centre cross.
									if (m.rows[i]?.kind === 'milestone' && x !== xs[1] && y !== ys[1]) continue;
									expect(hitTest(l, m, x, y)).toEqual({ kind: 'bar', row: i });
								}
							}
						});
					},
				),
				{ numRuns: 100 },
			);
		},
	);

	it('hit areas are at least 24 px (fine) and 44 px (coarse) wide', () => {
		for (const coarse of [false, true]) {
			const met = metricsOf(coarse);
			const m = modelOf([row(0, 0, 1), row(1, D, D, 'milestone'), row(2, 0, 5 * D, 'container')]);
			const l = createLayout(m, createScale(1, 0), met);
			for (let i = 0; i < 3; i++) {
				expect(l.hitRect(i)?.w ?? 0).toBeGreaterThanOrEqual(met.hitMin);
			}
		}
	});
});

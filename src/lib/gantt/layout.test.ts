// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	HIT_MIN_COARSE,
	HIT_MIN_FINE,
	createLayout,
	intersects,
	placeBar,
	metricsFor,
	revealTop,
	rowRange,
	scaleFor,
	type Rect,
} from './layout';
import { FALLBACK_THEME } from './paint/theme';
import { createScale } from './scale';
import { D, FIXED_MEASURE, link, metricsOf, modelOf, row } from './testing';

describe('metrics', () => {
	it('takes every size from the theme, so a token change moves the geometry', () => {
		const m = metricsFor(
			{ ...FALLBACK_THEME, rowHeight: 34, barHeight: 20, headerRow: 30, linkElbow: 12 },
			false,
		);
		expect(m).toMatchObject({
			rowHeight: 34,
			barHeight: 20,
			headerRow: 30,
			headerHeight: 60,
			elbow: 12,
		});
		const layout = createLayout(modelOf([row(0, 0, D)]), createScale(48, 0), m);
		expect(layout.barRect(0)).toMatchObject({ y: 7, h: 20 });
	});

	it('keeps the hit areas at the accessibility minimum, whatever the look', () => {
		expect(metricsOf(false).hitMin).toBe(HIT_MIN_FINE);
		expect(metricsOf(true).hitMin).toBe(HIT_MIN_COARSE);
		expect([HIT_MIN_FINE, HIT_MIN_COARSE]).toEqual([24, 44]);
		expect(metricsOf(true).rowHeight).toBeGreaterThan(metricsOf(false).rowHeight);
	});
});

describe('createLayout', () => {
	const scale = createScale(48, 0);
	const m = metricsOf(false);

	it('places a bar from its dates in the middle of its row', () => {
		const layout = createLayout(modelOf([row(0, 0, 2 * D), row(1, 2 * D, 5 * D)]), scale, m);
		expect(layout.barRect(0)).toEqual({ x: 0, y: 6, w: 96, h: 16 });
		expect(layout.barRect(1)).toEqual({ x: 96, y: 34, w: 144, h: 16 });
		expect(layout.height).toBe(56);
		expect(layout.rowTop(1)).toBe(28);
		expect(layout.rowAt(27)).toBe(0);
		expect(layout.rowAt(28)).toBe(1);
		expect(layout.rowAt(56)).toBeNull();
		expect(layout.rowAt(-1)).toBeNull();
	});

	it('draws no bar for an unscheduled row and keeps short bars visible', () => {
		const layout = createLayout(modelOf([row(0, null, null), row(1, 0, 10)]), scale, m);
		expect(layout.barRect(0)).toBeNull();
		expect(layout.hitRect(0)).toBeNull();
		expect(layout.barRect(1)?.w).toBe(m.minBarWidth);
		expect(layout.barRect(7)).toBeNull();
	});

	it('draws summaries thinner and milestones as a diamond centred on the date', () => {
		const layout = createLayout(
			modelOf([row(0, 0, 2 * D, 'container'), row(1, 3 * D, 3 * D, 'milestone')]),
			scale,
			m,
		);
		expect(layout.barRect(0)?.h).toBe(m.summaryHeight);
		const d = layout.barRect(1);
		expect(d).toMatchObject({ w: 2 * m.milestoneHalf, h: 2 * m.milestoneHalf });
		expect((d?.x ?? 0) + (d?.w ?? 0) / 2).toBe(144);
		expect((d?.y ?? 0) + (d?.h ?? 0) / 2).toBe(28 + 14);
	});

	it.each([false, true])('gives every hit area the minimum target size (coarse: %s)', (coarse) => {
		const met = metricsOf(coarse);
		const layout = createLayout(
			modelOf([row(0, 0, 5, 'task'), row(1, 0, 3 * D, 'container'), row(2, D, D, 'milestone')]),
			scale,
			met,
		);
		for (let i = 0; i < 3; i++) {
			const r = layout.hitRect(i);
			expect(r?.w).toBeGreaterThanOrEqual(met.hitMin);
			expect(r?.h).toBeGreaterThanOrEqual(Math.min(met.hitMin, met.rowHeight));
			// A hit area never reaches into the next row.
			expect((r?.y ?? 0) + (r?.h ?? 0)).toBeLessThanOrEqual(layout.rowTop(i + 1));
		}
	});

	it('keeps the content at least as wide as the viewport', () => {
		const narrow = modelOf([row(0, 0, D)], [], { endMin: 2 * D });
		expect(createLayout(narrow, scale, m, 800).width).toBe(800);
		expect(createLayout(narrow, scale, m).width).toBe(96);
	});

	it('routes a link out, down and in when the successor starts after the predecessor', () => {
		const layout = createLayout(modelOf([row(0, 0, 2 * D), row(1, 4 * D, 6 * D)]), scale, m);
		const path = layout.linkPath(link(0, 1));
		expect(path[0]).toEqual({ x: 96, y: 14 });
		expect(path[path.length - 1]).toEqual({ x: 192, y: 42 });
		expect(path.every((p, i) => i === 0 || p.x === path[i - 1]?.x || p.y === path[i - 1]?.y)).toBe(
			true,
		);
	});

	it('goes round through the row boundary when the successor starts first', () => {
		const layout = createLayout(modelOf([row(0, 2 * D, 4 * D), row(1, 0, 2 * D)]), scale, m);
		const down = layout.linkPath(link(0, 1));
		expect(down).toHaveLength(6);
		expect(down[2]?.y).toBe(28);
		const up = layout.linkPath(link(1, 0));
		expect(up.some((p) => p.y === 28)).toBe(true);
		expect(layout.linkPath(link(0, 5))).toEqual([]);
	});
});

describe('link routing by type', () => {
	const scale = createScale(48, 0);
	const m = metricsOf(false);
	const layout = createLayout(
		modelOf([
			row(0, 2 * D, 4 * D),
			row(1, 3 * D, 5 * D),
			row(2, 3 * D, 3 * D, 'milestone'),
			row(3, 3 * D, 6 * D),
		]),
		scale,
		m,
	);

	it('runs start to start round the left side with one bend', () => {
		const path = layout.linkPath(link(0, 1, { from: 'start', to: 'start' }));
		expect(path).toEqual([
			{ x: 96, y: 14 },
			{ x: 88, y: 14 },
			{ x: 88, y: 42 },
			{ x: 144, y: 42 },
		]);
	});

	it('runs end to end round the right side with one bend', () => {
		const path = layout.linkPath(link(0, 1, { from: 'end', to: 'end' }));
		expect(path).toEqual([
			{ x: 192, y: 14 },
			{ x: 249, y: 14 },
			{ x: 249, y: 42 },
			{ x: 240, y: 42 },
		]);
	});

	it('runs start to end, going round when the end is behind the start', () => {
		const path = layout.linkPath(link(0, 1, { from: 'start', to: 'end' }));
		expect(path).toEqual([
			{ x: 96, y: 14 },
			{ x: 88, y: 14 },
			{ x: 88, y: 28 },
			{ x: 249, y: 28 },
			{ x: 249, y: 42 },
			{ x: 240, y: 42 },
		]);
	});

	it('drops straight from a milestone to a task that starts at the same instant', () => {
		const path = layout.linkPath(link(2, 3));
		// From the diamond's bottom tip down to the successor's row: no loop round the start.
		expect(path).toEqual([
			{ x: 144, y: 2 * 28 + 14 + 8 },
			{ x: 144, y: 3 * 28 + 14 },
		]);
	});

	it('routes a milestone to a later task the usual way', () => {
		const later = createLayout(
			modelOf([row(0, 3 * D, 3 * D, 'milestone'), row(1, 6 * D, 8 * D)]),
			scale,
			m,
		);
		expect(later.linkPath(link(0, 1))).toHaveLength(4);
	});

	it('survives a cycle: a link each way is two paths, a link on itself none', () => {
		expect(layout.linkPath(link(0, 1)).length).toBeGreaterThan(1);
		expect(layout.linkPath(link(1, 0)).length).toBeGreaterThan(1);
		expect(layout.linkPath(link(1, 1)).length).toBeGreaterThanOrEqual(0);
	});
});

describe('scaleFor', () => {
	it('leaves room before the first date for half a diamond and a gap, in pixels at any zoom', () => {
		const m = metricsOf(false);
		const model = modelOf([row(0, 0, D)]);
		for (const pxPerDay of [1.2, 16, 56]) {
			expect(scaleFor(model, pxPerDay, m).x(0)).toBeCloseTo(m.originPad);
		}
		expect(m.originPad).toBe(16);
	});
});

describe('rowRange', () => {
	it('adds the overscan and stays inside the rows', () => {
		const layout = { rowCount: 500, metrics: metricsOf(false) };
		expect(rowRange(layout, 0, 280)).toEqual({ first: 0, last: 20 });
		expect(rowRange(layout, 28 * 100, 280)).toEqual({ first: 90, last: 120 });
		expect(rowRange(layout, 28 * 495, 280)).toEqual({ first: 485, last: 500 });
		expect(rowRange({ rowCount: 3, metrics: metricsOf(false) }, 0, 280)).toEqual({
			first: 0,
			last: 3,
		});
	});
});

describe('intersects', () => {
	it('is true only for overlapping rectangles', () => {
		const r: Rect = { x: 10, y: 10, w: 10, h: 10 };
		expect(intersects(r, 0, 0, 11, 11)).toBe(true);
		expect(intersects(r, 20, 0, 5, 50)).toBe(false);
		expect(intersects(r, 0, 20, 50, 5)).toBe(false);
	});
});

describe('layout typed arrays (phase-2.md 6.3)', () => {
	const m = modelOf([row(0, 0, 2 * D), row(1, null, null), row(2, 3 * D, 3 * D, 'milestone')]);
	const layout = createLayout(m, createScale(48, 0), metricsOf(false), 1000);

	it('keeps the bars in typed arrays, NaN for a row without one, and agrees with barRect', () => {
		expect(layout.bars.x).toBeInstanceOf(Float64Array);
		expect(Number.isNaN(layout.bars.x[1])).toBe(true);
		for (const i of [0, 2]) {
			const into = { x: 0, y: 0, w: 0, h: 0 };
			expect(layout.barInto(i, into)).toBe(true);
			expect(into).toEqual(layout.barRect(i));
		}
		const untouched = { x: 1, y: 2, w: 3, h: 4 };
		expect(layout.barInto(1, untouched)).toBe(false);
		expect(untouched).toEqual({ x: 1, y: 2, w: 3, h: 4 });
	});

	it('places a bar as the layout does, for the tween', () => {
		const out = { x: 0, y: 0, w: 0, h: 0 };
		placeBar(out, 'task', 0, 2 * D, 0, layout.scale, layout.metrics);
		expect(out).toEqual(layout.barRect(0));
		placeBar(out, 'milestone', 3 * D, 3 * D, 2 * 28, layout.scale, layout.metrics);
		expect(out).toEqual(layout.barRect(2));
	});

	it('fills a link path into a buffer, the same as linkPath', () => {
		const m2 = modelOf([row(0, 0, 2 * D), row(1, 4 * D, 6 * D)], [link(0, 1)]);
		const l = createLayout(m2, createScale(48, 0), metricsOf(false), 1000);
		const buf = { n: 0, xy: new Float64Array(12) };
		expect(l.linkInto(m2.links[0]!, buf)).toBe(true);
		const points = l.linkPath(m2.links[0]!);
		expect(buf.n).toBe(points.length);
		expect(points.map((p) => [p.x, p.y])).toEqual(
			Array.from({ length: buf.n }, (_, i) => [buf.xy[2 * i], buf.xy[2 * i + 1]]),
		);
		expect(l.linkInto(link(0, 5), buf)).toBe(false);
		expect(buf.n).toBe(0);
	});

	it('gives the same layout with other bars, sharing everything else', () => {
		const other = {
			x: new Float64Array([5, NaN, 7]),
			y: layout.bars.y,
			w: layout.bars.w,
			h: layout.bars.h,
		};
		const moved = layout.withBars(other);
		expect(moved.barRect(0)?.x).toBe(5);
		expect(moved.avatars).toBe(layout.avatars);
		expect(moved.width).toBe(layout.width);
		expect(moved.rowTop(2)).toBe(layout.rowTop(2));
	});
});

describe('names', () => {
	const m = metricsOf(false);
	const scale = createScale(48, 0);

	it('reserves where each name is: inside a bar that holds it, else beside the bar after a gap', () => {
		const layout = createLayout(
			modelOf([row(0, 0, 2 * D), row(1, 0, D / 2), row(2, null, null), row(3, 0, D, 'container')]),
			scale,
			m,
			0,
			FIXED_MEASURE,
		);
		const at = (i: number): number[] => Array.from(layout.labels.slice(3 * i, 3 * i + 3));
		// "Task 0" is 36 px: 6 px in from a 96 px bar.
		expect(at(0)).toEqual([m.labelPad, m.labelPad + 36, 1]);
		// A 24 px bar is too short for it: the name starts a gap after the bar.
		expect(at(1)).toEqual([24 + m.labelGap, 24 + m.labelGap + 36, 0]);
		expect(at(2).every(Number.isNaN)).toBe(true);
		expect(at(3).every(Number.isNaN)).toBe(true);
	});

	it('starts a name beside a bar after its float tail', () => {
		const layout = createLayout(
			modelOf([row(0, 0, D / 2, 'task', { floatMin: D, lateEnd: 3 * D })]),
			scale,
			m,
			0,
			FIXED_MEASURE,
		);
		expect(layout.labels[0]).toBe(3 * 48 + m.labelGap);
	});

	it('reserves nothing without a text measure', () => {
		expect(createLayout(modelOf([row(0, 0, D / 2)]), scale, m).labels).toHaveLength(0);
	});

	it('steps a link off the name of a row it passes, and not off one inside a bar', () => {
		// Row 1's short bar ends at 91, so its name runs from 105 to 141 across the leg at 104.
		const rows = [row(0, 0, 2 * D), row(1, 2640, 2650), row(2, 6 * D, 7 * D)];
		const across = createLayout(modelOf(rows, [link(0, 2)]), scale, m, 0, FIXED_MEASURE);
		const plain = createLayout(modelOf(rows, [link(0, 2)]), scale, m);
		expect(plain.linkPath(link(0, 2))[1]?.x).toBe(104);
		expect(across.linkPath(link(0, 2))[1]?.x).toBe(141 + 3);
		// The same link and a bar wide enough to hold its name: the leg runs behind the bar.
		const wide = [rows[0]!, row(1, 2640, 2640 + 3 * D), rows[2]!];
		const inside = createLayout(modelOf(wide, [link(0, 2)]), scale, m, 0, FIXED_MEASURE);
		expect(inside.linkPath(link(0, 2))[1]?.x).toBe(104);
	});
});

describe('revealTop', () => {
	it('keeps the offset while the row is in view, and scrolls the least to show it', () => {
		expect(revealTop(5, 28, 0, 280)).toBe(0);
		expect(revealTop(2, 28, 100, 280)).toBe(56);
		expect(revealTop(20, 28, 0, 280)).toBe(20 * 28 + 28 - 280);
	});
});

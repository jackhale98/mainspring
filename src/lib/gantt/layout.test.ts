// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	HIT_MIN_COARSE,
	HIT_MIN_FINE,
	createLayout,
	intersects,
	metricsFor,
	paintWindow,
	rowRange,
	scaleFor,
	type Rect,
} from './layout';
import { FALLBACK_THEME } from './paint/theme';
import { createScale } from './scale';
import { D, link, metricsOf, modelOf, row } from './testing';

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
			{ x: 248, y: 14 },
			{ x: 248, y: 42 },
			{ x: 240, y: 42 },
		]);
	});

	it('runs start to end, going round when the end is behind the start', () => {
		const path = layout.linkPath(link(0, 1, { from: 'start', to: 'end' }));
		expect(path).toEqual([
			{ x: 96, y: 14 },
			{ x: 88, y: 14 },
			{ x: 88, y: 28 },
			{ x: 248, y: 28 },
			{ x: 248, y: 42 },
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

describe('paintWindow', () => {
	const opt = { overscanX: 300, overscanY: 280 };
	const content = { w: 10_000, h: 14_000 };

	it('covers the view with the overscan and stays inside the content', () => {
		const w = paintWindow({ x: 2000, y: 3000, w: 800, h: 500 }, content, opt, null);
		expect(w).toEqual({ x: 1700, y: 2720, w: 1400, h: 1060 });
		const edge = paintWindow({ x: 0, y: 0, w: 800, h: 500 }, content, opt, null);
		expect(edge).toMatchObject({ x: 0, y: 0 });
		const end = paintWindow({ x: 9200, y: 13_500, w: 800, h: 500 }, content, opt, null);
		expect(end.x + end.w).toBe(10_000);
		expect(end.y + end.h).toBe(14_000);
	});

	it('keeps the same window while the view is inside it with a margin', () => {
		const first = paintWindow({ x: 2000, y: 3000, w: 800, h: 500 }, content, opt, null);
		const again = paintWindow({ x: 2050, y: 3100, w: 800, h: 500 }, content, opt, first);
		expect(again).toBe(first);
	});

	it('moves the window when the view nears its edge, and back to the start', () => {
		const first = paintWindow({ x: 2000, y: 3000, w: 800, h: 500 }, content, opt, null);
		const next = paintWindow({ x: 2000 + 250, y: 3000, w: 800, h: 500 }, content, opt, first);
		expect(next).not.toBe(first);
		expect(next.x).toBeLessThanOrEqual(2250 - 100);
		const vertical = paintWindow({ x: 2000, y: 3000 + 400, w: 800, h: 500 }, content, opt, first);
		expect(vertical).not.toBe(first);
		const home = paintWindow({ x: 0, y: 0, w: 800, h: 500 }, content, opt, first);
		expect(home).toMatchObject({ x: 0, y: 0 });
	});

	it('is a single window when the content is smaller than the view plus overscan', () => {
		const small = { w: 900, h: 300 };
		const first = paintWindow({ x: 0, y: 0, w: 800, h: 500 }, small, opt, null);
		expect(first).toEqual({ x: 0, y: 0, w: 900, h: 300 });
		expect(paintWindow({ x: 100, y: 0, w: 800, h: 500 }, small, opt, first)).toBe(first);
	});

	it('makes a new window when the viewport is resized', () => {
		const first = paintWindow({ x: 2000, y: 3000, w: 800, h: 500 }, content, opt, null);
		const bigger = paintWindow({ x: 2000, y: 3000, w: 1000, h: 500 }, content, opt, first);
		expect(bigger.w).toBe(1600);
	});
});

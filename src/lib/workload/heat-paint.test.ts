// SPDX-License-Identifier: GPL-2.0-or-later
// The heatmap's painters (phase-3.md 8.1) on a recording 2D context: runs of one band are one
// fill, text is drawn only where cells are wide enough and never in off cells, the fill count
// stays within the frame budget on a full desktop window, and the overlay draws its lines and
// rings without a layout read. Patterns need a canvas: where a test does not stub one they are
// absent and the hatch and stripe fills are not counted (the screenshots show them).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { at, plan, weekdays } from '../schedule/testing';
import { availabilityOf } from './availability';
import { heatLayout } from './heat-layout';
import { clearPatternCache, paintCells, paintOverlay, type OverlayFrame } from './heat-paint';
import { FALLBACK_HEAT_THEME } from './heat-theme';
import { buildLoad } from './load';
import { booking, indexOf, resourceResult, withPeople } from './testing';
import { DEFAULT_THRESHOLDS, type Band, type BucketKind, type LoadModel } from './types';

interface Call {
	op: string;
	args: unknown[];
	fill: unknown;
}

/** A 2D context that records what is drawn, with the few properties the painters set. */
function recorder(patterns = false) {
	const calls: Call[] = [];
	const state = { fillStyle: '' as unknown, font: '', textAlign: '', textBaseline: '' };
	const ctx = new Proxy(state, {
		get(target, prop: string) {
			if (prop in target) return (target as Record<string, unknown>)[prop];
			if (prop === 'canvas') return { width: 100, height: 100 };
			if (prop === 'createPattern') return () => (patterns ? { setTransform() {} } : null);
			if (prop === 'measureText') return (t: string) => ({ width: t.length * 6 });
			return (...args: unknown[]) => {
				calls.push({ op: prop, args, fill: target.fillStyle });
			};
		},
		set(target, prop: string, value) {
			(target as Record<string, unknown>)[prop] = value;
			return true;
		},
	}) as unknown as CanvasRenderingContext2D;
	return { ctx, calls, count: (op: string) => calls.filter((c) => c.op === op).length };
}

const TEXT = `project p "P" 2026-01-05 - 2026-03-02 {
}
resource dev1 "Dev 1"
resource dev2 "Dev 2"
task a "A" { effort 5d allocate dev1 }
`;

function model(kind: BucketKind = 'week') {
	const r: ScheduleResult = withPeople(
		plan([['a', { start: at(0, 9), end: at(4, 17) }]]),
		[resourceResult('dev1'), resourceResult('dev2', { workingTime: weekdays(56).slice(0, 10) })],
		[
			booking(
				'dev1',
				'a',
				[0, 1, 2, 3, 4].map((d): [number, number] => [at(d, 9), at(d, 17)]),
			),
		],
	);
	return buildLoad({
		result: r,
		index: indexOf(TEXT),
		zones: createTimeZoneHost(),
		kind,
		collapsed: new Set(),
		availability: availabilityOf(r, 'plan'),
		demand: null,
	});
}

/** 40 rows, 52 columns: every row has four runs of 13 columns, the bands rotating from row to row. */
function budgetModel(): LoadModel {
	const BANDS: readonly Band[] = ['off', 'spare', 'full', 'over'];
	const rows = 40;
	const cols = 52;
	const grid = (v: number): Int32Array[] =>
		Array.from({ length: rows }, () => new Int32Array(cols).fill(v));
	return {
		revision: 1,
		scenario: 'plan',
		axis: {
			kind: 'day',
			bounds: Int32Array.from({ length: cols + 1 }, (_, i) => i * 1440),
			count: cols,
			indexOf: () => 0,
		},
		rows: Array.from({ length: rows }, (_, i) => ({
			id: `p${i}`,
			name: `P${i}`,
			depth: 0,
			group: false,
			expanded: null,
			textOnly: null,
		})),
		booked: grid(480),
		available: grid(480),
		leave: grid(0),
		held: grid(0),
		unmet: grid(0),
		band: (r, c) => BANDS[(Math.floor(c / 13) + r) % 4] as Band,
		cellTasks: () => [],
		dimmed: false,
	};
}

function budgetFrame(hatched = false) {
	const m = budgetModel();
	const layout = heatLayout(40, 52, { rowHeight: 28, colWidth: 32 });
	const { ctx } = recorder(hatched);
	const stats = paintCells({
		ctx,
		win: { x: 0, y: 0, w: layout.width, h: layout.height },
		dpr: 1,
		layout,
		model: m,
		thresholds: DEFAULT_THRESHOLDS,
		unit: 'hours',
		heat: FALLBACK_HEAT_THEME,
		surface: '#fffdf8',
		fontSans: 'sans-serif',
	});
	return { stats, cells: m.rows.length * m.axis.count };
}

const frameOf = (m: ReturnType<typeof model>, col: number, win?: { w: number; h: number }) => {
	const layout = heatLayout(m.rows.length, m.axis.count, { rowHeight: 28, colWidth: col });
	const { ctx, calls, count } = recorder();
	const stats = paintCells({
		ctx,
		win: { x: 0, y: 0, w: win?.w ?? layout.width, h: win?.h ?? layout.height },
		dpr: 1,
		layout,
		model: m,
		thresholds: DEFAULT_THRESHOLDS,
		unit: 'hours',
		heat: FALLBACK_HEAT_THEME,
		surface: '#fffdf8',
		fontSans: 'sans-serif',
	});
	return { stats, calls, count, layout };
};

describe('paintCells', () => {
	it('fills a run of one band as one rectangle', () => {
		const m = model('week');
		const { calls, layout } = frameOf(m, 56);
		const heat = FALLBACK_HEAT_THEME;
		// Dev 1: full for week 0, then spare (nothing booked) for the rest: two runs.
		const row0 = calls.filter(
			(c) =>
				c.op === 'fillRect' &&
				(c.args[1] as number) === layout.rowTop(0) &&
				(c.args[3] as number) === 28,
		);
		const bands = row0.filter((c) => c.fill === heat.full || c.fill === heat.spare);
		expect(bands.map((c) => [c.fill, c.args[0], c.args[2]])).toEqual([
			[heat.full, 0, 56],
			[heat.spare, 56, 56 * 7],
		]);
	});

	it('draws a face in each working cell and none in an off cell', () => {
		const m = model('week');
		const { stats, count, calls } = frameOf(m, 56);
		expect(stats.texts).toBe(count('fillText'));
		const faces = calls.filter((c) => c.op === 'fillText').map((c) => c[`args`][0]);
		expect(faces).toContain('40h');
		expect(faces).toContain('0h');
		// Dev 2 has working time in the first two weeks only (10 working days): off afterwards.
		expect(stats.texts).toBe(8 + 2);
	});

	it('draws no text where a cell is narrower than 32 px', () => {
		const { stats } = frameOf(model('week'), 24);
		expect(stats.texts).toBe(0);
	});

	it('stays within the fill budget for a full desktop window of 40 rows and alternating bands', () => {
		const { stats, cells } = budgetFrame();
		// 40 rows x 52 columns = 2,080 cells in four runs a row: runs, not cells, are filled.
		expect(cells).toBe(2080);
		expect(stats.fillRects).toBeLessThanOrEqual(600);
		expect(stats.fillRects).toBeGreaterThan(40 * 4);
	});

	describe('with a canvas for the hatches', () => {
		afterEach(() => {
			vi.unstubAllGlobals();
			clearPatternCache();
		});

		it('hatches an over run with one fill, not one per cell', () => {
			clearPatternCache();
			const plain = budgetFrame().stats.fillRects;
			clearPatternCache();
			const tile = {
				getContext: () => new Proxy({}, { get: () => () => undefined }),
				width: 0,
				height: 0,
			};
			vi.stubGlobal('document', { createElement: () => tile });
			vi.stubGlobal('DOMMatrix', class {});
			const { stats } = budgetFrame(true);
			// The pattern fills are the over runs only: a quarter of the 40 x 4 runs.
			expect(stats.fillRects - plain).toBe(40);
			expect(stats.fillRects).toBeLessThanOrEqual(600);
		});
	});

	it('paints only the cells of the window', () => {
		const m = model('week');
		const { stats } = frameOf(m, 56, { w: 112, h: 28 });
		expect(stats.texts).toBe(2);
	});

	it('paints nothing but the ground for an empty window', () => {
		const m = model('week');
		const layout = heatLayout(m.rows.length, m.axis.count, { rowHeight: 28, colWidth: 56 });
		const { ctx, calls } = recorder();
		const stats = paintCells({
			ctx,
			win: { x: 9999, y: 9999, w: 100, h: 100 },
			dpr: 1,
			layout,
			model: m,
			thresholds: DEFAULT_THRESHOLDS,
			unit: 'hours',
			heat: FALLBACK_HEAT_THEME,
			surface: '#fff',
			fontSans: 'sans-serif',
		});
		expect(stats.texts).toBe(0);
		expect(calls.filter((c) => c.op === 'fillText')).toHaveLength(0);
	});
});

describe('paintOverlay', () => {
	const layout = heatLayout(3, 8, { rowHeight: 28, colWidth: 56 });
	const colours = {
		accent: '#a',
		accentText: '#b',
		focus: '#c',
		today: '#d',
		status: '#e',
		blocked: '#f',
		text: '#g',
		surface: '#h',
	};
	const frame = (over: Partial<OverlayFrame>): OverlayFrame => ({
		ctx: recorder().ctx,
		win: { x: 0, y: 0, w: 448, h: 84 },
		dpr: 1,
		layout,
		lines: [],
		selected: null,
		focus: null,
		hover: null,
		lifted: null,
		drag: null,
		colours,
		markerWidth: 1.5,
		dash: 4,
		fontSans: 'sans-serif',
		fontSize: 12,
		...over,
	});

	it('draws a solid today line over the whole height, and a dashed status line', () => {
		const t = recorder();
		paintOverlay(frame({ ctx: t.ctx, lines: [{ x: 100, kind: 'today' }] }));
		const today = t.calls.filter((c) => c.op === 'fillRect' && c.fill === '#d');
		expect(today).toHaveLength(1);
		expect(today[0]?.args[3]).toBe(84);
		const s = recorder();
		paintOverlay(frame({ ctx: s.ctx, lines: [{ x: 100, kind: 'status' }] }));
		expect(s.calls.filter((c) => c.op === 'fillRect' && c.fill === '#e').length).toBeGreaterThan(3);
	});

	it('leaves out a line outside the window', () => {
		const t = recorder();
		paintOverlay(frame({ ctx: t.ctx, lines: [{ x: 9000, kind: 'today' }] }));
		expect(t.calls.filter((c) => c.op === 'fillRect')).toHaveLength(0);
	});

	it('rings the selected and the focused cell, the focus ring 3 px', () => {
		const t = recorder();
		paintOverlay(frame({ ctx: t.ctx, selected: { row: 1, col: 2 }, focus: { row: 0, col: 0 } }));
		const rings = t.calls.filter((c) => c.op === 'strokeRect');
		expect(rings).toHaveLength(2);
	});

	it('draws the drag target and its label', () => {
		const t = recorder();
		paintOverlay(
			frame({
				ctx: t.ctx,
				drag: { target: { row: 2, col: 1 }, ok: true, label: { text: 'To Dev 3', x: 60, y: 50 } },
			}),
		);
		expect(t.calls.some((c) => c.op === 'fillText' && c.args[0] === 'To Dev 3')).toBe(true);
	});
});

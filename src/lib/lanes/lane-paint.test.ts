// SPDX-License-Identifier: GPL-2.0-or-later
// The lanes' painters (phase-3.md 8.1, 9.4) on a recording 2D context: bars with the task's name
// only where it fits, the text-only bar dashed with its badge, the red over strip under the lane
// over the periods that are over (by the thresholds), a group's thin roll-up, only the rows of the
// window, and the overlay's rings. Patterns need a canvas: where a test does not stub one they are
// absent (the screenshots show them).
import { describe, expect, it } from 'vitest';
import { FALLBACK_THEME } from '../gantt/paint/theme';
import { heatLayout } from '../workload/heat-layout';
import { overlayLook } from '../workload/heat-paint';
import { FALLBACK_HEAT_THEME as HEAT } from '../workload/heat-theme';
import { DEFAULT_THRESHOLDS } from '../workload/types';
import { barBox, overBox } from './lane-geom';
import { paintLanes, paintLanesOverlay } from './lane-paint';
import { FALLBACK_LANE_THEME as LANE } from './lane-theme';
import { lanesOf, macroText, rowOf } from './testing';

interface Call {
	op: string;
	args: unknown[];
	fill: unknown;
	dash: unknown;
}

function recorder() {
	const calls: Call[] = [];
	const state = {
		fillStyle: '' as unknown,
		strokeStyle: '' as unknown,
		font: '',
		textAlign: '',
		textBaseline: '',
		lineDash: [] as unknown,
	};
	const ctx = new Proxy(state, {
		get(target, prop: string) {
			if (prop in target) return (target as Record<string, unknown>)[prop];
			if (prop === 'canvas') return { width: 100, height: 100 };
			if (prop === 'createPattern') return () => null;
			if (prop === 'measureText') return (t: string) => ({ width: t.length * 6 });
			if (prop === 'setLineDash') {
				return (d: unknown) => {
					target.lineDash = d;
					calls.push({ op: prop, args: [d], fill: target.fillStyle, dash: d });
				};
			}
			return (...args: unknown[]) => {
				calls.push({ op: prop, args, fill: target.fillStyle, dash: target.lineDash });
			};
		},
		set(target, prop: string, value) {
			(target as Record<string, unknown>)[prop] = value;
			return true;
		},
	}) as unknown as CanvasRenderingContext2D;
	return { ctx, calls, ops: (op: string) => calls.filter((c) => c.op === op) };
}

const T = DEFAULT_THRESHOLDS;

function frame(
	lanes = lanesOf(),
	thresholds = T,
	win?: { x: number; y: number; w: number; h: number },
) {
	const { load } = lanes;
	const layout = heatLayout(load.rows.length, load.axis.count, {
		rowHeight: LANE.rowHeight,
		colWidth: 112,
	});
	const r = recorder();
	const stats = paintLanes({
		ctx: r.ctx,
		win: win ?? { x: 0, y: 0, w: layout.width, h: layout.height },
		dpr: 1,
		layout,
		lanes,
		thresholds,
		heat: HEAT,
		lane: LANE,
		theme: FALLBACK_THEME,
	});
	return { ...r, stats, layout, lanes };
}

describe('paintLanes', () => {
	it('draws a bar for each booked task, with its name where the name fits', () => {
		const f = frame();
		const texts = f.ops('fillText').map((c) => c.args[0]);
		// Ann: pair and parent.child, 960 minutes over 8.4 weeks of 112 px: 3 px per... a bar is
		// ~1.4 of 112 px wide a day; names fit only where the bar is wider than the name.
		for (const t of texts) expect(typeof t).toBe('string');
		expect(f.stats.texts).toBe(f.ops('fillText').length);
		expect(f.ops('stroke').length).toBeGreaterThan(0);
	});

	it('writes a name on a bar wide enough for it, and none on a narrow one', () => {
		// At day zoom a bar is wide; at month zoom it is a few pixels.
		const wide = frameAt('day', 56);
		const narrow = frameAt('month', 20);
		expect(wide.ops('fillText').map((c) => c.args[0])).toContain('pair');
		expect(narrow.ops('fillText').map((c) => c.args[0])).not.toContain('pair');
	});

	it('draws the over strip under the lane over the periods that are over, and nowhere else', () => {
		const strict = frame(lanesOf(), { spareBelow: 20, overAbove: 50 });
		const lane = strict.lanes;
		const a = rowOf(lane, 'a');
		// Ann is at 80 % in week 0: over a 50 % threshold.
		const strip = overBox(strict.layout, LANE, a, 0, 1);
		const reds = strict.ops('fillRect').filter((c) => c.fill === HEAT.over);
		expect(
			reds.some((c) => c.args[0] === strip.x && c.args[1] === strip.y && c.args[3] === strip.h),
		).toBe(true);
		// Under the heatmap's thresholds nothing is over: no red.
		const calm = frame();
		expect(calm.ops('fillRect').filter((c) => c.fill === HEAT.over)).toHaveLength(0);
	});

	it('draws a group row as a thin band in the band colours, with no bars', () => {
		const f = frame();
		const team = rowOf(f.lanes, 'team');
		const top = f.layout.rowTop(team);
		const band = f.ops('fillRect').filter((c) => {
			const y = c.args[1] as number;
			return y > top && y < top + LANE.rowHeight && c.args[3] === LANE.groupHeight;
		});
		expect(band.length).toBeGreaterThan(0);
		expect(f.lanes.runs(team)).toEqual([]);
	});

	it('paints only the rows of the window', () => {
		const lanes = lanesOf();
		const layout = heatLayout(lanes.load.rows.length, lanes.load.axis.count, {
			rowHeight: LANE.rowHeight,
			colWidth: 112,
		});
		const first = frame(lanes, T, { x: 0, y: 0, w: layout.width, h: LANE.rowHeight });
		const all = frame(lanes);
		expect(first.stats.fillRects).toBeLessThan(all.stats.fillRects);
	});

	it('draws a text-only bar dashed and faint, with the badge', () => {
		const { text, line } = macroText();
		const lanes = lanesOf(text, 'day', { task: 'late', line });
		const layout = heatLayout(lanes.load.rows.length, lanes.load.axis.count, {
			rowHeight: LANE.rowHeight,
			colWidth: 56,
		});
		const r = recorder();
		paintLanes({
			ctx: r.ctx,
			win: { x: 0, y: 0, w: layout.width, h: layout.height },
			dpr: 1,
			layout,
			lanes,
			thresholds: T,
			heat: HEAT,
			lane: LANE,
			theme: FALLBACK_THEME,
		});
		// A dash was set for the outline, and the badge glyph was written.
		expect(r.ops('setLineDash').some((c) => Array.isArray(c.dash) && c.dash.length === 2)).toBe(
			true,
		);
		expect(r.ops('fillText').map((c) => c.args[0])).toContain('T');
	});

	it('stays within the fill budget on this plan', () => {
		expect(frame().stats.fillRects).toBeLessThanOrEqual(600);
	});
});

function frameAt(kind: 'day' | 'month', colWidth: number) {
	const lanes = lanesOf(undefined, kind);
	const layout = heatLayout(lanes.load.rows.length, lanes.load.axis.count, {
		rowHeight: LANE.rowHeight,
		colWidth,
	});
	const r = recorder();
	paintLanes({
		ctx: r.ctx,
		win: { x: 0, y: 0, w: layout.width, h: layout.height },
		dpr: 1,
		layout,
		lanes,
		thresholds: T,
		heat: HEAT,
		lane: LANE,
		theme: FALLBACK_THEME,
	});
	return r;
}

describe('paintLanesOverlay', () => {
	function overlay(extra: Partial<Parameters<typeof paintLanesOverlay>[0]>) {
		const lanes = lanesOf();
		const layout = heatLayout(lanes.load.rows.length, lanes.load.axis.count, {
			rowHeight: LANE.rowHeight,
			colWidth: 112,
		});
		const r = recorder();
		paintLanesOverlay({
			ctx: r.ctx,
			win: { x: 0, y: 0, w: layout.width, h: layout.height },
			dpr: 1,
			layout,
			lines: [],
			selected: null,
			focus: null,
			hover: null,
			lifted: null,
			drag: null,
			...overlayLook(FALLBACK_THEME, HEAT),
			lanes,
			lane: LANE,
			hoverBar: null,
			liftedBar: null,
			selectedTask: null,
			...extra,
		});
		return { ...r, lanes, layout };
	}

	it('draws nothing but the lines when nothing is selected or hovered', () => {
		expect(overlay({}).ops('stroke')).toHaveLength(0);
	});

	it('rings the bars of the selected task, and the hovered and lifted bar', () => {
		const lanes = lanesOf();
		const a = rowOf(lanes, 'a');
		const bar = lanes.runs(a)[0];
		if (!bar) throw new Error('no bar');
		expect(overlay({ selectedTask: bar.task }).ops('stroke')).toHaveLength(1);
		expect(overlay({ hoverBar: { row: a, bar } }).ops('stroke')).toHaveLength(1);
		const lifted = overlay({ liftedBar: { row: a, bar } });
		expect(lifted.ops('stroke')).toHaveLength(1);
		expect(lifted.ops('setLineDash').length).toBeGreaterThan(0);
	});

	it('rings a bar at the bar box, a pixel outside it', () => {
		const lanes = lanesOf();
		const a = rowOf(lanes, 'a');
		const bar = lanes.runs(a)[0];
		if (!bar) throw new Error('no bar');
		const o = overlay({ hoverBar: { row: a, bar } });
		const b = barBox(o.layout, o.lanes.load.axis, LANE, a, bar);
		// The first corner of the ring's path runs to a pixel outside the box's right edge and top.
		const corner = o.ops('arcTo')[0];
		expect(corner?.args.slice(0, 2)).toEqual([b.x + b.w + 1, b.y - 1]);
	});
});

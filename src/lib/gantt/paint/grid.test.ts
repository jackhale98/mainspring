// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { MIN_PER_DAY } from '../scale';
import { ticksFor } from '../ticks';
import { D, modelOf, row } from '../testing';
import { markerLines, paintGrid } from './grid';
import { frameOf } from './testing';

const utc = { startEpoch: Date.UTC(2026, 0, 5) / 1000, env: { zone: null }, locale: 'en-US' };

describe('markerLines', () => {
	it('draws the status date and today as two lines when they are apart', () => {
		const m = modelOf([], [], { statusMin: 2 * D, todayMin: 5 * D });
		expect(markerLines(m)).toEqual([
			{ at: 2 * D, kind: 'status' },
			{ at: 5 * D, kind: 'today' },
		]);
	});

	it('merges the two into one when they fall within an hour (a plan without now)', () => {
		const m = modelOf([], [], { statusMin: 3 * D, todayMin: 3 * D + 40 });
		expect(markerLines(m)).toEqual([{ at: 3 * D, kind: 'both' }]);
	});

	it('draws what it has', () => {
		expect(markerLines(modelOf([]))).toEqual([]);
		// Today may come from outside the model.
		expect(markerLines(modelOf([], [], { statusMin: 2 * D }), 5 * D)).toEqual([
			{ at: 2 * D, kind: 'status' },
			{ at: 5 * D, kind: 'today' },
		]);
		expect(markerLines(modelOf([], [], { todayMin: 5 }))).toEqual([{ at: 5, kind: 'today' }]);
	});
});

describe('paintGrid', () => {
	const rows = Array.from({ length: 6 }, (_, i) => row(i, 0, D));

	it('clears and fills the window, then draws a separator per row', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintGrid(frame, null);
		expect(rec.of('clearRect')).toHaveLength(1);
		expect(rec.of('setTransform').at(-1)).toEqual(['setTransform', 1, 0, 0, 1, -0, -0]);
		const fills = rec.of('fillRect');
		// The surface, then six separators.
		expect(fills).toHaveLength(1 + 6);
		expect(fills[0]).toEqual(['fillRect', 0, 0, 1000, 168]);
	});

	it('maps content to the canvas with the pixel ratio and the window origin', () => {
		const { frame, rec } = frameOf(modelOf(rows), {
			dpr: 2,
			win: { x: 120, y: 40, w: 500, h: 200 },
		});
		paintGrid(frame, null);
		expect(rec.of('setTransform').at(-1)).toEqual(['setTransform', 2, 0, 0, 2, -240, -80]);
	});

	it('draws a line per tick edge inside the window, and only those', () => {
		const model = modelOf(rows, [], { calendar: null });
		const { frame, rec } = frameOf(model, { win: { x: 0, y: 0, w: 480, h: 168 } });
		const ticks = ticksFor(utc, 0, 20 * MIN_PER_DAY, 48);
		paintGrid(frame, ticks);
		const lines = rec.of('fillRect').filter((c) => c[4] === 168 && (c[3] as number) < 1.5);
		const xs = lines.map((c) => c[1]);
		// 48 px per day: edges at 0, 48 ... 480 (the major month edge before the window is not drawn).
		expect(xs).toContain(48);
		expect(xs).not.toContain(528);
		expect(Math.max(...(xs as number[]))).toBeLessThanOrEqual(481);
	});

	it('snaps lines to device pixels and draws them one device pixel wide', () => {
		const { frame, rec } = frameOf(modelOf(rows), { dpr: 2 });
		// 0.3 day at 48 px per day is x = 14.4, which is 28.8 device pixels: snapped to 29, so 14.5.
		const ticks = { level: 'day' as const, major: [], minor: [{ at: 0.3 * D, end: D, label: '' }] };
		paintGrid(frame, ticks);
		const line = rec.of('fillRect').find((c) => c[1] === 14.5);
		expect(line).toEqual(['fillRect', 14.5, 0, 0.5, 168]);
	});

	it('draws no today or status line: they follow the clock and live on the overlay layer', () => {
		const model = modelOf(rows, [], { statusMin: 2 * D, todayMin: 4 * D });
		const { frame, rec } = frameOf(model, { win: { x: 0, y: 0, w: 1000, h: 100 } });
		paintGrid(frame, null);
		const styles = rec.of('set:fillStyle').map((c) => c[1]);
		expect(styles).not.toContain(frame.theme.today);
		expect(styles).not.toContain(frame.theme.statusDate);
	});

	it('tints the selected row under the bars, and draws separators only when the token says so', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintGrid({ ...frame, theme: { ...frame.theme, rowLineWidth: 0 } }, null, 2);
		const fills = rec.of('fillRect');
		// The surface and the selected row's tint: no separators.
		expect(fills).toEqual([
			['fillRect', 0, 0, 1000, 168],
			['fillRect', 0, 56, 1000, 28],
		]);
		expect(rec.of('set:fillStyle').map((c) => c[1])).toContain(frame.theme.rowSelected);
	});

	it('moves nothing but the canvas on a vertical move, and redraws only the tint', () => {
		const base = frameOf(modelOf(rows), { win: { x: 0, y: 0, w: 1000, h: 112 } });
		const frame = { ...base.frame, theme: { ...base.frame.theme, rowLineWidth: 0 } };
		const rec = base.rec;
		const ticks = { level: 'day' as const, major: [], minor: [{ at: D, end: 2 * D, label: '' }] };
		paintGrid(frame, ticks, 1);
		rec.clear();
		// Down by one row: the canvas moves with the content, the lines still fill it.
		const down = { ...frame, win: { x: 0, y: 28, w: 1000, h: 112 } };
		paintGrid(down, ticks, 1);
		expect(rec.of('drawImage')).toHaveLength(0);
		// The tint was drawn at canvas y 28, which is content y 56 now; the selected row is at 28.
		const cleared = rec
			.of('clearRect')
			.map((c) => c.slice(1))
			.sort((a, b) => Number(a[1]) - Number(b[1]));
		expect(cleared).toEqual([
			[0, 28, 1000, 28],
			[0, 56, 1000, 28],
		]);
		// Same window, same selection: nothing at all.
		rec.clear();
		paintGrid(down, ticks, 1);
		expect(rec.calls.filter((c) => c[0] === 'clearRect')).toHaveLength(0);
		// A move sideways paints it all again, and nothing is copied.
		rec.clear();
		paintGrid({ ...down, win: { x: 40, y: 28, w: 1000, h: 112 } }, ticks, 1);
		expect(rec.of('drawImage')).toHaveLength(0);
		expect(rec.of('clearRect').map((c) => c.slice(1))).toEqual([[0, 0, 1000, 600]]);
	});

	it('repaints in full on a vertical move when the theme draws row separators', () => {
		const { frame, rec } = frameOf(modelOf(rows), { win: { x: 0, y: 0, w: 1000, h: 112 } });
		paintGrid(frame, null, null);
		rec.clear();
		paintGrid({ ...frame, win: { x: 0, y: 28, w: 1000, h: 112 } }, null, null);
		expect(rec.of('clearRect').map((c) => c.slice(1))).toEqual([[0, 0, 1000, 600]]);
	});
});

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

	it('draws today solid and the status date dashed, in their own colours', () => {
		const model = modelOf(rows, [], { statusMin: 2 * D, todayMin: 4 * D });
		const { frame, rec } = frameOf(model, { win: { x: 0, y: 0, w: 1000, h: 100 } });
		paintGrid(frame, null);
		const styles = rec.of('set:fillStyle').map((c) => c[1]);
		expect(styles).toContain(frame.theme.today);
		expect(styles).toContain(frame.theme.statusDate);
		const todayX = (4 * D * 48) / MIN_PER_DAY - 1;
		const solid = rec.of('fillRect').filter((c) => c[1] === todayX && c[4] === 100);
		expect(solid).toHaveLength(1);
		const dashes = rec.of('fillRect').filter((c) => c[1] === 95 && c[4] === 6);
		expect(dashes.length).toBeGreaterThan(5);
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
});

// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { D, link, modelOf, row } from '../testing';
import { paintLinks, roundedPolyline } from './links';
import { bufOf } from '../route';
import { frameOf, recorder } from './testing';

describe('roundedPolyline', () => {
	it('rounds a corner with a quadratic curve, pulling the lines back by the radius', () => {
		const rec = recorder();
		roundedPolyline(
			rec.ctx,
			bufOf([
				{ x: 0, y: 0 },
				{ x: 20, y: 0 },
				{ x: 20, y: 30 },
			]),
			4,
		);
		expect(rec.calls).toEqual([
			['moveTo', 0, 0],
			['lineTo', 16, 0],
			['quadraticCurveTo', 20, 0, 20, 4],
			['lineTo', 20, 30],
		]);
	});

	it('keeps a sharp corner where a segment is too short for a curve', () => {
		const rec = recorder();
		roundedPolyline(
			rec.ctx,
			bufOf([
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
				{ x: 1, y: 30 },
			]),
			4,
		);
		expect(rec.of('quadraticCurveTo')).toHaveLength(0);
		expect(rec.of('lineTo')).toHaveLength(2);
	});

	it('limits the radius to half of the shorter neighbouring segment', () => {
		const rec = recorder();
		roundedPolyline(
			rec.ctx,
			bufOf([
				{ x: 0, y: 0 },
				{ x: 20, y: 0 },
				{ x: 20, y: 6 },
			]),
			4,
		);
		expect(rec.of('quadraticCurveTo')[0]).toEqual(['quadraticCurveTo', 20, 0, 20, 3]);
	});
});

describe('paintLinks', () => {
	const rows = [row(0, 0, 2 * D), row(1, 4 * D, 6 * D)];

	it('strokes a link with an open arrow head, a little short of the bar', () => {
		const { frame, rec, layout } = frameOf(modelOf(rows, [link(0, 1)]));
		paintLinks(frame);
		const path = layout.linkPath(frame.model.links[0]!);
		const end = path[path.length - 1];
		// Two strokes: the line, then the arrow; the arrow is lines only, never a filled triangle.
		expect(rec.of('stroke')).toHaveLength(2);
		expect(rec.of('fill')).toHaveLength(0);
		// The last line stops `linkGap` before the bar's edge, the arrow's tip is there too.
		const tip = rec.of('lineTo').at(-2);
		expect(tip?.[1]).toBeCloseTo((end?.x ?? 0) - frame.theme.linkGap);
	});

	it('points the arrow along the last segment: left for a link that ends on a bar end', () => {
		const m = modelOf(rows, [link(0, 1, { from: 'end', to: 'end' })]);
		const { frame, rec } = frameOf(m);
		paintLinks(frame);
		const tip = rec.of('lineTo').at(-2) as unknown as [string, number, number];
		const wing = rec.of('moveTo').at(-1) as unknown as [string, number, number];
		// The wings are to the right of the tip: the head points left.
		expect(wing[1]).toBeGreaterThan(tip[1]);
	});

	it('draws the states differently: dashed for the engine, dotted and pending-coloured while pending', () => {
		const m = modelOf(
			[row(0, 0, D), row(1, 2 * D, 3 * D), row(2, 4 * D, 5 * D), row(3, 6 * D, 7 * D)],
			[link(0, 1), link(1, 2, { state: 'engine' }), link(2, 3, { state: 'pending' })],
		);
		const { frame, rec } = frameOf(m);
		paintLinks(frame);
		const dashes = rec.of('setLineDash').map((c) => c[1] as number[]);
		expect(dashes.some((d) => d.length === 2 && d[0] === frame.theme.dash)).toBe(true);
		expect(dashes.some((d) => d.length === 2 && d[0] === frame.theme.linkWidth)).toBe(true);
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toContain(frame.theme.pending);
	});

	it('draws critical links in the critical colour and thicker', () => {
		const { frame, rec } = frameOf(modelOf(rows, [link(0, 1, { critical: true })]));
		paintLinks(frame);
		expect(rec.of('set:strokeStyle')[0]?.[1]).toBe(frame.theme.critical);
		expect(rec.of('set:lineWidth')[0]?.[1]).toBe(frame.theme.linkWidthCritical);
	});

	it('skips a link with no bar at an end, and links outside the window', () => {
		const m = modelOf([row(0, 0, D), row(1, null, null)], [link(0, 1)]);
		const { frame, rec } = frameOf(m);
		paintLinks(frame);
		expect(rec.of('stroke')).toHaveLength(0);
		const far = frameOf(modelOf(rows, [link(0, 1)]), { win: { x: 5000, y: 0, w: 500, h: 100 } });
		paintLinks(far.frame);
		expect(far.rec.of('stroke')).toHaveLength(0);
	});
});

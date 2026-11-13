// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { D, link, modelOf, row } from '../testing';
import { MIN_PER_DAY } from '../scale';
import { paintLinks } from './links';
import { NO_OVERLAY, linkPathOf, paintOverlay } from './overlay';
import { frameOf } from './testing';

const rows = [row(0, 0, 2 * D), row(1, 2 * D, 5 * D), row(2, 3 * D, 3 * D, 'milestone')];

describe('paintOverlay', () => {
	it('draws nothing but the clear for an empty state', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintOverlay(frame, NO_OVERLAY);
		expect(rec.of('clearRect')).toHaveLength(1);
		expect(rec.of('fillRect')).toHaveLength(0);
		expect(rec.of('stroke')).toHaveLength(0);
	});

	it('rings the selected bar; the row tint belongs to the grid layer', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintOverlay(frame, { ...NO_OVERLAY, selectedRow: 1 });
		expect(rec.of('fillRect')).toHaveLength(0);
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toContain(frame.theme.focus);
		expect(rec.of('stroke')).toHaveLength(1);
		expect(rec.of('set:lineWidth')[0]?.[1]).toBe(2);
	});

	it('rings a milestone as a diamond', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintOverlay(frame, { ...NO_OVERLAY, selectedRow: 2 });
		expect(rec.of('lineTo')).toHaveLength(3);
		expect(rec.of('arcTo')).toHaveLength(0);
	});

	it('outlines the hovered bar without veiling it, and not the selected one twice', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintOverlay(frame, { selectedRow: 0, hoverRow: 0, hoverLink: null });
		expect(rec.of('stroke')).toHaveLength(1);
		rec.clear();
		paintOverlay(frame, { selectedRow: 0, hoverRow: 1, hoverLink: null });
		// The hover outline, then the selection ring, and no filled band over any bar.
		expect(rec.of('stroke')).toHaveLength(2);
		expect(rec.of('fillRect')).toHaveLength(0);
		expect(rec.of('fill')).toHaveLength(0);
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toEqual([
			frame.theme.borderStrong,
			frame.theme.focus,
		]);
	});

	it('ignores rows outside the painted window', () => {
		const { frame, rec } = frameOf(modelOf(rows), { win: { x: 0, y: 28, w: 1000, h: 28 } });
		paintOverlay(frame, { selectedRow: 0, hoverRow: 2, hoverLink: null });
		expect(rec.of('fillRect')).toHaveLength(0);
		expect(rec.of('stroke')).toHaveLength(0);
	});

	it('highlights a hovered link on the same shortened, rounded path as the base layer', () => {
		const m = modelOf(
			[row(0, 0, 2 * D), row(1, 3 * D, 5 * D), row(2, 0, 2 * D)],
			[link(0, 1), link(0, 2)],
		);
		const base = frameOf(m);
		paintLinks(base.frame);
		const { frame, rec } = frameOf(m);
		paintOverlay(frame, { ...NO_OVERLAY, hoverLink: 1 });
		const line = (calls: readonly (readonly unknown[])[]) =>
			calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo' || c[0] === 'quadraticCurveTo');
		// The overlay's line is a run of the base layer's calls: the second link's path.
		// (without the arrow head, three more calls)
		const drawn = line(rec.calls).slice(0, -3);
		const all = line(base.rec.calls);
		const at = all.findIndex((_c, i) =>
			drawn.every((d, j) => JSON.stringify(all[i + j]) === JSON.stringify(d)),
		);
		expect(at).toBeGreaterThanOrEqual(0);
		// Thicker, in the accent; the arrow head is drawn too.
		expect(rec.of('set:lineWidth')[0]?.[1]).toBe(frame.theme.linkWidthHover);
		expect(rec.of('set:strokeStyle')[0]?.[1]).toBe(frame.theme.accent);
		expect(rec.of('stroke')).toHaveLength(1);
		expect(rec.of('quadraticCurveTo').length).toBeGreaterThan(0);
	});

	it('draws today solid and the status date dashed, in their own colours', () => {
		const model = modelOf(rows, [], { statusMin: 2 * D, todayMin: 4 * D });
		const { frame, rec } = frameOf(model, { win: { x: 0, y: 0, w: 1000, h: 100 } });
		paintOverlay(frame, NO_OVERLAY);
		const styles = rec.of('set:fillStyle').map((c) => c[1]);
		expect(styles).toContain(frame.theme.today);
		expect(styles).toContain(frame.theme.statusDate);
		const todayX = (4 * D * 48) / MIN_PER_DAY - 1;
		const solid = rec.of('fillRect').filter((c) => c[1] === todayX && c[4] === 100);
		expect(solid).toHaveLength(1);
		const dashes = rec.of('fillRect').filter((c) => c[1] === 95 && c[4] === 6);
		expect(dashes.length).toBeGreaterThan(5);
	});

	it('takes today from the overlay state, so that the clock is not part of the model', () => {
		const model = modelOf(rows, [], { statusMin: 2 * D });
		const { frame, rec } = frameOf(model, { win: { x: 0, y: 0, w: 1000, h: 100 } });
		paintOverlay(frame, { ...NO_OVERLAY, todayMin: 6 * D });
		const x = (6 * D * 48) / MIN_PER_DAY - 1;
		expect(rec.of('fillRect').filter((c) => c[1] === x && c[4] === 100)).toHaveLength(1);
		// A state that says "no today" wins over the model's own.
		rec.clear();
		paintOverlay(
			{ ...frame, model: { ...model, todayMin: 3 * D } },
			{ ...NO_OVERLAY, todayMin: null },
		);
		expect(rec.of('set:fillStyle').map((c) => c[1])).not.toContain(frame.theme.today);
	});

	it('has no path for a link index that does not exist', () => {
		const { layout } = frameOf(modelOf(rows));
		expect(linkPathOf(layout, modelOf(rows), 3)).toEqual([]);
	});
});

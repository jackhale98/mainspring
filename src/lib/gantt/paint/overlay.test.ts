// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { D, link, modelOf, row } from '../testing';
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

	it('highlights a hovered link along its path', () => {
		const m = modelOf(rows, [link(0, 1)]);
		const { frame, rec, layout } = frameOf(m);
		paintOverlay(frame, { ...NO_OVERLAY, hoverLink: 0 });
		expect(rec.of('moveTo')).toHaveLength(1);
		expect(rec.of('lineTo')).toHaveLength(linkPathOf(layout, m, 0).length - 1);
		expect(rec.of('stroke')).toHaveLength(1);
	});

	it('has no path for a link index that does not exist', () => {
		const { layout } = frameOf(modelOf(rows));
		expect(linkPathOf(layout, modelOf(rows), 3)).toEqual([]);
	});
});

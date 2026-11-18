// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { placeBeside, type Box } from './place';

const view = { width: 360, height: 640 };
const box = (left: number, top: number, w = 44, h = 44): Box => ({
	left,
	top,
	right: left + w,
	bottom: top + h,
});

describe('placeBeside', () => {
	it('opens below, lined up with the start of the anchor', () => {
		const p = placeBeside(box(20, 100), { width: 180, height: 200 }, view, { align: 'start' });
		expect(p.left).toBe(20);
		expect(p.top).toBe(150);
		expect(p.maxHeight).toBeGreaterThanOrEqual(200);
	});

	it('lines up with the end of the anchor when asked', () => {
		const p = placeBeside(box(300, 100), { width: 180, height: 100 }, view, { align: 'end' });
		expect(p.left + 180).toBe(344);
	});

	it('stays inside the viewport at 360 px: a wide panel is pulled back from the right and the left', () => {
		const right = placeBeside(box(300, 100), { width: 200, height: 100 }, view, { align: 'start' });
		expect(right.left).toBe(360 - 200 - 8);
		const left = placeBeside(box(2, 100), { width: 200, height: 100 }, view, { align: 'end' });
		expect(left.left).toBe(8);
	});

	it('is pinned to the margin when the panel is wider than the viewport', () => {
		const p = placeBeside(box(100, 100), { width: 500, height: 100 }, view, { align: 'start' });
		expect(p.left).toBe(8);
	});

	it('flips above when it does not fit below and there is more room above', () => {
		const p = placeBeside(box(20, 560), { width: 180, height: 250 }, view, { align: 'start' });
		expect(p.top + 250).toBe(560 - 6);
		expect(p.top).toBeGreaterThanOrEqual(8);
	});

	it('stays below when it fits, even if there is more room above', () => {
		const p = placeBeside(box(20, 300), { width: 180, height: 150 }, view, { align: 'start' });
		expect(p.top).toBe(350);
	});

	it('takes the larger side and scrolls when neither fits', () => {
		const p = placeBeside(box(20, 300), { width: 180, height: 900 }, view, { align: 'start' });
		expect(p.maxHeight).toBeLessThan(900);
		expect(p.top).toBeGreaterThanOrEqual(8);
		expect(p.top + p.maxHeight).toBeLessThanOrEqual(640 - 8);
	});
});

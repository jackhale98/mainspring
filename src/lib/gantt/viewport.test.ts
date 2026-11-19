// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	NO_EDGE_HOLD,
	edgeHoldAt,
	edgeVelocity,
	heldEdgeVelocity,
	sheetTopOf,
	visibleChart,
} from './viewport';

const scroller = { left: 0, top: 100, right: 1000, bottom: 700 };

describe('visibleChart', () => {
	it('is the scroller without the task column and the time header', () => {
		expect(visibleChart(scroller, 300, 64, { sheetTop: null, drawerLeft: null })).toEqual({
			left: 300,
			top: 164,
			right: 1000,
			bottom: 700,
		});
	});

	it('stops at a bottom sheet and at a drawer over the right edge', () => {
		expect(visibleChart(scroller, 300, 64, { sheetTop: 400, drawerLeft: 680 })).toEqual({
			left: 300,
			top: 164,
			right: 680,
			bottom: 400,
		});
	});

	it('is never inside out when a sheet covers nearly everything', () => {
		const b = visibleChart(scroller, 300, 64, { sheetTop: 120, drawerLeft: 200 });
		expect(b.right).toBeGreaterThanOrEqual(b.left);
		expect(b.bottom).toBeGreaterThanOrEqual(b.top);
	});
});

describe('edgeVelocity', () => {
	const box = { left: 300, top: 164, right: 680, bottom: 400 };

	it('does not scroll in the middle, and scrolls toward a covered edge as the pointer nears it', () => {
		expect(edgeVelocity(500, 300, box, true)).toEqual({ x: 0, y: 0 });
		// 20 px from the drawer's edge, not from the (covered) scroller's edge at 1000.
		expect(edgeVelocity(660, 300, box, true).x).toBeGreaterThan(0);
		expect(edgeVelocity(320, 300, box, true).x).toBeLessThan(0);
		expect(edgeVelocity(500, 390, box, true).y).toBeGreaterThan(0);
	});

	it('leaves the vertical axis alone for drags that only move in time', () => {
		expect(edgeVelocity(500, 395, box, false).y).toBe(0);
	});
});

describe('heldEdgeVelocity', () => {
	const box = { left: 300, top: 164, right: 680, bottom: 400 };

	it('is edgeVelocity for a drag that began away from the edges', () => {
		const hold = edgeHoldAt(500, 300, box);
		expect(hold).toEqual(NO_EDGE_HOLD);
		for (const [x, y] of [
			[500, 300],
			[660, 300],
			[320, 390],
		] as const) {
			const v = heldEdgeVelocity(hold, x, y, box, true);
			expect({ x: v.x, y: v.y }).toEqual(edgeVelocity(x, y, box, true));
		}
	});

	it('keeps the chart still for a drag that began in the right band and moves left', () => {
		// The bar's end sits 10 px inside the covered drawer's edge: the finger goes left 3 px a frame.
		let hold = edgeHoldAt(670, 300, box);
		for (let x = 670; x > 600; x -= 3) {
			const v = heldEdgeVelocity(hold, x, 300, box, true);
			expect(v.x, `x ${x}`).toBe(0);
			hold = v.hold;
		}
		expect(hold).toEqual(NO_EDGE_HOLD);
	});

	it('still scrolls a drag that began in the band and goes on toward the edge', () => {
		const hold = edgeHoldAt(670, 300, box);
		expect(heldEdgeVelocity(hold, 685, 300, box, true).x).toBeGreaterThan(0);
	});

	it('holds the vertical band too, and leaves it off for drags that only move in time', () => {
		const hold = edgeHoldAt(500, 395, box);
		expect(heldEdgeVelocity(hold, 500, 380, box, true).y).toBe(0);
		expect(heldEdgeVelocity(hold, 500, 395 + 12, box, true).y).toBeGreaterThan(0);
		expect(heldEdgeVelocity(hold, 500, 395 + 12, box, false).y).toBe(0);
	});
});

describe('sheetTopOf', () => {
	it('is the viewport height less the sheet, or null for none', () => {
		expect(sheetTopOf(300, 800)).toBe(500);
		expect(sheetTopOf(0, 800)).toBeNull();
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPinchTracker, pinchZoom, scrollLeftForAnchor } from './pinch';

describe('pinch tracker', () => {
	const a = { x: 100, y: 100 };
	const b = { x: 200, y: 100 };

	it('anchors at the starting centroid', () => {
		expect(createPinchTracker(a, b, 8).anchor).toEqual({ x: 150, y: 100 });
	});

	it('is silent in the dead zone and then reports a cumulative scale', () => {
		const t = createPinchTracker(a, b, 8);
		expect(t.update({ x: 104, y: 100 }, { x: 196, y: 100 })).toEqual({ scale: null, pan: null });
		// Engages here: the scale starts at 1, with no jump by the dead zone, and is cumulative after.
		expect(t.update({ x: 50, y: 100 }, { x: 250, y: 100 })).toEqual({ scale: 1, pan: null });
		expect(t.update({ x: 25, y: 100 }, { x: 275, y: 100 }).scale).toBe(1.25);
		expect(t.update({ x: 100, y: 100 }, { x: 200, y: 100 }).scale).toBe(0.5);
	});

	it('reports centroid movement as increments, starting from the anchor', () => {
		const t = createPinchTracker(a, b, 8);
		expect(t.update({ x: 120, y: 100 }, { x: 220, y: 100 }).pan).toEqual({ dx: 20, dy: 0 });
		expect(t.update({ x: 130, y: 110 }, { x: 230, y: 110 }).pan).toEqual({ dx: 10, dy: 10 });
	});

	it('measures the horizontal gap: fingers moving apart vertically do not zoom time', () => {
		const t = createPinchTracker({ x: 100, y: 50 }, { x: 100, y: 150 }, 8);
		expect(t.update({ x: 100, y: 0 }, { x: 100, y: 300 }).scale).toBeNull();
	});

	it('does not engage on a gap narrower than the minimum, then engages without a jump', () => {
		const t = createPinchTracker({ x: 100, y: 100 }, { x: 100, y: 100 }, 8);
		expect(t.update({ x: 95, y: 100 }, { x: 105, y: 100 }).scale).toBeNull();
		expect(t.update({ x: 80, y: 100 }, { x: 120, y: 100 }).scale).toBe(1);
	});

	it('a pair that begins together stays finite', () => {
		const t = createPinchTracker(a, a, 8);
		const f = t.update({ x: 100, y: 100 }, { x: 140, y: 100 });
		expect(Number.isFinite(f.scale ?? 0)).toBe(true);
	});

	it('the sum of the pan increments is the centroid displacement once panning', () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(fc.integer({ min: -30, max: 30 }), fc.integer({ min: -30, max: 30 })), {
					minLength: 1,
					maxLength: 20,
				}),
				(steps) => {
					const t = createPinchTracker(a, b, 8);
					let cx = 0;
					let cy = 0;
					let sx = 0;
					let sy = 0;
					let panned = false;
					for (const [dx, dy] of steps) {
						cx += dx;
						cy += dy;
						const f = t.update({ x: a.x + cx, y: a.y + cy }, { x: b.x + cx, y: b.y + cy });
						if (f.pan) {
							panned = true;
							sx += f.pan.dx;
							sy += f.pan.dy;
						}
					}
					if (panned) {
						expect(sx).toBeCloseTo(cx);
						expect(sy).toBeCloseTo(cy);
					}
				},
			),
		);
	});
});

describe('zoom anchoring', () => {
	it('keeps the anchor minute under the same viewport x after a zoom', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 100000 }),
				fc.integer({ min: 0, max: 1000 }),
				fc.double({ min: 0.001, max: 0.2, noNaN: true }),
				(anchorMin, viewportX, pxPerMin) => {
					const origin = 500;
					const left = scrollLeftForAnchor(anchorMin, viewportX, origin, pxPerMin);
					expect((anchorMin - origin) * pxPerMin - left).toBeCloseTo(viewportX, 6);
				},
			),
		);
	});

	it('clamps the zoom', () => {
		expect(pinchZoom(16, 2, 0.8, 96)).toBe(32);
		expect(pinchZoom(16, 100, 0.8, 96)).toBe(96);
		expect(pinchZoom(16, 0.001, 0.8, 96)).toBe(0.8);
	});
});

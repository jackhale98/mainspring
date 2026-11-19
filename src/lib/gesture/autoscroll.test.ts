// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	AUTOSCROLL_ARM_PX,
	AUTOSCROLL_MAX_PX_PER_S,
	NO_HOLD,
	AxisScroll,
	bandVelocity,
	heldVelocity,
	holdAt,
} from './autoscroll';

describe('bandVelocity', () => {
	it('is zero away from the edges', () => {
		expect(bandVelocity(300, 0, 600)).toBe(0);
		expect(bandVelocity(48, 0, 600)).toBe(0);
		expect(bandVelocity(552, 0, 600)).toBe(0);
	});
	it('ramps up toward each edge and caps at 600 px/s', () => {
		expect(bandVelocity(24, 0, 600)).toBe(-300);
		expect(bandVelocity(576, 0, 600)).toBe(300);
		expect(bandVelocity(0, 0, 600)).toBe(-600);
		expect(bandVelocity(600, 0, 600)).toBe(600);
		expect(bandVelocity(-500, 0, 600)).toBe(-600);
		expect(bandVelocity(900, 0, 600)).toBe(600);
	});
	it('works for a viewport that does not start at zero', () => {
		expect(bandVelocity(110, 100, 700)).toBeLessThan(0);
		expect(bandVelocity(400, 100, 700)).toBe(0);
	});
	it('a viewport too small for two bands splits it, and an empty one does not scroll', () => {
		expect(bandVelocity(10, 0, 40)).toBeLessThan(0);
		expect(bandVelocity(30, 0, 40)).toBeGreaterThan(0);
		expect(bandVelocity(5, 10, 10)).toBe(0);
	});
	it('never exceeds the cap and is monotonic toward the edges', () => {
		fc.assert(
			fc.property(fc.integer({ min: -200, max: 800 }), (p) => {
				const v = bandVelocity(p, 0, 600);
				expect(Math.abs(v)).toBeLessThanOrEqual(AUTOSCROLL_MAX_PX_PER_S);
				if (p < 300) expect(bandVelocity(p - 1, 0, 600)).toBeLessThanOrEqual(v);
				else expect(bandVelocity(p + 1, 0, 600)).toBeGreaterThanOrEqual(v);
			}),
		);
	});
});

describe('a drag that begins inside an edge band', () => {
	// Viewport [0, 600]: bands [0, 48) and (552, 600].
	it('holds the band it began in, and no other', () => {
		expect(holdAt(300, 0, 600)).toEqual(NO_HOLD);
		expect(holdAt(570, 0, 600)).toEqual({ min: null, max: 570 });
		expect(holdAt(20, 0, 600)).toEqual({ min: 20, max: null });
		expect(holdAt(10, 10, 10)).toEqual(NO_HOLD);
	});

	it('does not scroll toward that edge while the pointer moves away from it', () => {
		const hold = holdAt(570, 0, 600);
		// The pointer is still in the band, a few px to the left: free of nothing yet.
		for (const pos of [570, 566, 560, 555]) {
			const r = heldVelocity(hold, pos, 0, 600);
			expect(r.velocity).toBe(0);
			expect(r.hold).toEqual(hold);
		}
		// Out of the band: the hold ends.
		expect(heldVelocity(hold, 540, 0, 600)).toEqual({ velocity: 0, hold: NO_HOLD });
	});

	it('scrolls once the pointer goes toward the edge by the arming distance', () => {
		const hold = holdAt(570, 0, 600);
		expect(heldVelocity(hold, 570 + AUTOSCROLL_ARM_PX - 1, 0, 600).velocity).toBe(0);
		const r = heldVelocity(hold, 570 + AUTOSCROLL_ARM_PX, 0, 600);
		expect(r.velocity).toBe(bandVelocity(582, 0, 600));
		expect(r.velocity).toBeGreaterThan(0);
		expect(r.hold).toEqual(NO_HOLD);
		// Armed for good: moving back inside the band scrolls on.
		const back = heldVelocity(r.hold, 565, 0, 600);
		expect(back.velocity).toBeGreaterThan(0);
	});

	it('holds the near edge the same way', () => {
		const hold = holdAt(20, 0, 600);
		expect(heldVelocity(hold, 30, 0, 600).velocity).toBe(0);
		expect(heldVelocity(hold, 20 - AUTOSCROLL_ARM_PX, 0, 600).velocity).toBeLessThan(0);
	});

	it('scrolls the far edge as ever while the near edge holds, and after leaving a band re-entering it scrolls', () => {
		const hold = holdAt(570, 0, 600);
		const left = heldVelocity(hold, 300, 0, 600);
		expect(left).toEqual({ velocity: 0, hold: NO_HOLD });
		expect(heldVelocity(left.hold, 575, 0, 600).velocity).toBeGreaterThan(0);
		expect(heldVelocity(left.hold, 10, 0, 600).velocity).toBeLessThan(0);
	});

	it('an unheld drag scrolls exactly as bandVelocity says', () => {
		for (const pos of [-20, 0, 30, 300, 560, 600, 700]) {
			expect(heldVelocity(NO_HOLD, pos, 0, 600).velocity).toBe(bandVelocity(pos, 0, 600));
		}
	});
});

describe('AxisScroll', () => {
	it('holds the band the drag began in, frame by frame, and scrolls once it goes toward the edge', () => {
		const a = new AxisScroll();
		a.begin(570, 0, 600);
		for (const pos of [570, 560, 556]) expect(a.velocity(pos, 0, 600)).toBe(0);
		expect(a.velocity(570 + AUTOSCROLL_ARM_PX, 0, 600)).toBeGreaterThan(0);
		// Armed: back in the band, it scrolls.
		expect(a.velocity(565, 0, 600)).toBeGreaterThan(0);
	});

	it('a drag that began in the middle scrolls at the edges as ever', () => {
		const a = new AxisScroll();
		a.begin(300, 0, 600);
		expect(a.velocity(590, 0, 600)).toBe(bandVelocity(590, 0, 600));
		expect(a.velocity(5, 0, 600)).toBe(bandVelocity(5, 0, 600));
	});

	it('begins afresh for the next drag', () => {
		const a = new AxisScroll();
		a.begin(570, 0, 600);
		a.velocity(300, 0, 600);
		a.begin(575, 0, 600);
		expect(a.velocity(570, 0, 600)).toBe(0);
	});
});

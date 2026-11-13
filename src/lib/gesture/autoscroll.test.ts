// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AUTOSCROLL_MAX_PX_PER_S, autoScrollVelocity } from './autoscroll';

describe('autoScrollVelocity', () => {
	it('is zero away from the edges', () => {
		expect(autoScrollVelocity(300, 0, 600)).toBe(0);
		expect(autoScrollVelocity(48, 0, 600)).toBe(0);
		expect(autoScrollVelocity(552, 0, 600)).toBe(0);
	});
	it('ramps up toward each edge and caps at 600 px/s', () => {
		expect(autoScrollVelocity(24, 0, 600)).toBe(-300);
		expect(autoScrollVelocity(576, 0, 600)).toBe(300);
		expect(autoScrollVelocity(0, 0, 600)).toBe(-600);
		expect(autoScrollVelocity(600, 0, 600)).toBe(600);
		expect(autoScrollVelocity(-500, 0, 600)).toBe(-600);
		expect(autoScrollVelocity(900, 0, 600)).toBe(600);
	});
	it('works for a viewport that does not start at zero', () => {
		expect(autoScrollVelocity(110, 100, 700)).toBeLessThan(0);
		expect(autoScrollVelocity(400, 100, 700)).toBe(0);
	});
	it('a viewport too small for two bands splits it, and an empty one does not scroll', () => {
		expect(autoScrollVelocity(10, 0, 40)).toBeLessThan(0);
		expect(autoScrollVelocity(30, 0, 40)).toBeGreaterThan(0);
		expect(autoScrollVelocity(5, 10, 10)).toBe(0);
	});
	it('never exceeds the cap and is monotonic toward the edges', () => {
		fc.assert(
			fc.property(fc.integer({ min: -200, max: 800 }), (p) => {
				const v = autoScrollVelocity(p, 0, 600);
				expect(Math.abs(v)).toBeLessThanOrEqual(AUTOSCROLL_MAX_PX_PER_S);
				if (p < 300) expect(autoScrollVelocity(p - 1, 0, 600)).toBeLessThanOrEqual(v);
				else expect(autoScrollVelocity(p + 1, 0, 600)).toBeGreaterThanOrEqual(v);
			}),
		);
	});
});

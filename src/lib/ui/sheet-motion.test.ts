// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The sheet's shared motion (sheet-motion.ts): its curve, and that nothing moves with reduced motion.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cubicBezier,
	glideFrom,
	reducedMotion,
	slideUp,
	SHEET_MS,
	SHEET_OUT_MS,
} from './sheet-motion';

function motion(reduce: boolean): void {
	vi.stubGlobal('matchMedia', () => ({ matches: reduce }));
}
afterEach(() => vi.unstubAllGlobals());

describe('cubicBezier', () => {
	const ease = cubicBezier(0.32, 0.72, 0, 1);
	it('starts at 0, ends at 1 and never goes backwards', () => {
		expect(ease(0)).toBe(0);
		expect(ease(1)).toBe(1);
		let last = 0;
		for (let i = 1; i <= 100; i++) {
			const v = ease(i / 100);
			expect(v).toBeGreaterThanOrEqual(last - 1e-9);
			last = v;
		}
	});
	it('is fast first and slow at the end (most of the travel is done by half time)', () => {
		expect(ease(0.5)).toBeGreaterThan(0.85);
	});
	it('is the identity for a straight line', () => {
		expect(cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3)(0.3)).toBeCloseTo(0.3, 3);
	});
});

describe('slideUp', () => {
	it('slides by translateY only, longer in than out', () => {
		motion(false);
		const inn = slideUp(document.createElement('div'), {}, { direction: 'in' });
		const out = slideUp(document.createElement('div'), {}, { direction: 'out' });
		expect(inn.duration).toBe(SHEET_MS);
		expect(out.duration).toBe(SHEET_OUT_MS);
		expect(inn.css(1, 0.25)).toBe('transform: translateY(25%)');
	});
	it('plays nothing with reduced motion or when it is a column', () => {
		motion(true);
		expect(slideUp(document.createElement('div')).duration).toBe(0);
		motion(false);
		expect(slideUp(document.createElement('div'), { enabled: false }).duration).toBe(0);
	});
});

describe('glideFrom', () => {
	it('animates the transform from the old top edge', () => {
		motion(false);
		const el = document.createElement('div');
		const animate = vi.fn(() => ({}) as Animation);
		el.animate = animate as unknown as typeof el.animate;
		glideFrom(el, 120);
		const calls = animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][];
		expect(calls[0]?.[0]).toEqual([
			{ transform: 'translateY(120px)' },
			{ transform: 'translateY(0)' },
		]);
	});
	it('does nothing for no change, or with reduced motion', () => {
		motion(false);
		const el = document.createElement('div');
		const animate = vi.fn();
		el.animate = animate as unknown as typeof el.animate;
		expect(glideFrom(el, 0)).toBeNull();
		motion(true);
		expect(glideFrom(el, 50)).toBeNull();
		expect(animate).not.toHaveBeenCalled();
		expect(reducedMotion()).toBe(true);
	});
});

// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The Calendar's slide (slide-up.ts): translateY only, longer in than out, and nothing with reduced motion.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slideUp, SHEET_MS, SHEET_OUT_MS } from './slide-up';

function motion(reduce: boolean): void {
	vi.stubGlobal('matchMedia', () => ({ matches: reduce }));
}
afterEach(() => vi.unstubAllGlobals());

describe('slideUp', () => {
	it('slides by translateY only, longer in than out, and settles at both ends', () => {
		motion(false);
		const inn = slideUp(document.createElement('div'), {}, { direction: 'in' });
		const out = slideUp(document.createElement('div'), {}, { direction: 'out' });
		expect(inn.duration).toBe(SHEET_MS);
		expect(out.duration).toBe(SHEET_OUT_MS);
		expect(inn.css(1, 0.25)).toBe('transform: translateY(25%)');
		for (const e of [inn.easing, out.easing]) {
			expect(e(0)).toBe(0);
			expect(e(1)).toBe(1);
		}
		// It arrives fast: most of the travel is done by half time.
		expect(inn.easing(0.5)).toBeGreaterThan(0.85);
	});
	it('plays nothing with reduced motion or when it is a column', () => {
		motion(true);
		expect(slideUp(document.createElement('div')).duration).toBe(0);
		motion(false);
		expect(slideUp(document.createElement('div'), { enabled: false }).duration).toBe(0);
	});
});

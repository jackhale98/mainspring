// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The Calendar's slide (slide-up.ts): translateY only, as long as the sheet tokens say, none with them at 0.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slideUp } from './slide-up';

function tokens(values: Record<string, string>): void {
	vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (n: string) => values[n] ?? '' }));
}
afterEach(() => vi.unstubAllGlobals());

describe('slideUp', () => {
	it('slides by translateY only, for the token durations, and settles at both ends', () => {
		tokens({ '--sheet-ms': '200', '--sheet-out-ms': '180' });
		const inn = slideUp(document.createElement('div'), {}, { direction: 'in' });
		const out = slideUp(document.createElement('div'), {}, { direction: 'out' });
		expect(inn.duration).toBe(200);
		expect(out.duration).toBe(180);
		expect(inn.css(1, 0.25)).toBe('transform: translateY(25%)');
		for (const e of [inn.easing, out.easing]) {
			expect(e(0)).toBe(0);
			expect(e(1)).toBe(1);
		}
		// It arrives fast: most of the travel is done by half time.
		expect(inn.easing(0.5)).toBeGreaterThan(0.85);
	});
	it('plays nothing with reduced motion (tokens 0) or when it is a column', () => {
		tokens({ '--sheet-ms': '0', '--sheet-out-ms': '0' });
		expect(slideUp(document.createElement('div')).duration).toBe(0);
		tokens({ '--sheet-ms': '200', '--sheet-out-ms': '180' });
		expect(slideUp(document.createElement('div'), { enabled: false }).duration).toBe(0);
	});
});

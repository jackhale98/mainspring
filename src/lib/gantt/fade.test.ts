// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FADE_END, labelFade } from './fade';

describe('labelFade', () => {
	it('shows the whole label while the cell has room for it', () => {
		expect(labelFade(200, 100)).toBe(1);
		expect(labelFade(100, 100)).toBe(1);
	});

	it('fades in a line as the room falls below the label width, and is gone at the end', () => {
		expect(labelFade(100 * FADE_END, 100)).toBe(0);
		expect(labelFade(0, 100)).toBe(0);
		expect(labelFade(-30, 100)).toBe(0);
		expect(labelFade(100 * ((1 + FADE_END) / 2), 100)).toBeCloseTo(0.5);
	});

	it('never falls as the room grows, and stays in 0 to 1', () => {
		let last = 0;
		for (let room = -20; room <= 160; room += 3) {
			const v = labelFade(room, 100);
			expect(v).toBeGreaterThanOrEqual(last);
			expect(v).toBeLessThanOrEqual(1);
			last = v;
		}
	});

	it('leaves a label of no width alone', () => {
		expect(labelFade(5, 0)).toBe(1);
	});
});

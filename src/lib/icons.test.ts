// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ICONS } from './icons';

describe('icons', () => {
	it('has well-formed path data for every icon', () => {
		const names = Object.keys(ICONS);
		expect(names.length).toBeGreaterThan(15);
		for (const [name, paths] of Object.entries(ICONS)) {
			expect(paths.length, name).toBeGreaterThan(0);
			for (const d of paths) {
				expect(d, name).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/);
				expect(d.startsWith('M') || d.startsWith('m'), name).toBe(true);
				expect(d, name).not.toMatch(/NaN|undefined/);
			}
		}
	});

	it('keeps the shapes the mode switch and the toggles need', () => {
		for (const name of ['code', 'split', 'visual', 'undo', 'redo', 'sun', 'moon', 'system']) {
			expect(ICONS).toHaveProperty(name);
		}
	});
});

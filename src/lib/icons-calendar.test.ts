// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICONS } from './icons';
import { MODE_ICONS } from './icons-calendar';

describe('the Calendar mode icons', () => {
	it('has well-formed path data for pointer, brush and eraser', () => {
		expect(Object.keys(MODE_ICONS).sort()).toEqual(['brush', 'eraser', 'pointer']);
		for (const [name, paths] of Object.entries(MODE_ICONS)) {
			expect(paths.length, name).toBeGreaterThan(0);
			for (const d of paths) {
				expect(d, name).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/);
				expect(d.startsWith('M') || d.startsWith('m'), name).toBe(true);
				expect(d, name).not.toMatch(/NaN|undefined/);
			}
		}
	});

	it('is not in the first load icons, and names its licence', () => {
		for (const name of Object.keys(MODE_ICONS)) expect(ICONS).not.toHaveProperty(name);
		const src = readFileSync(new URL('./icons-calendar.ts', import.meta.url), 'utf8');
		expect(src).toContain('Lucide');
		expect(src).toContain('ISC');
	});
});

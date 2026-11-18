// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NARROW_FORMS, TIERS, isNarrowForm, tiersAt, undeclared } from './toolbar-tiers';

const css = readFileSync(new URL('../../styles/toolbar.css', import.meta.url), 'utf8');

describe('tiersAt', () => {
	it('names the tiers in force for a container and a viewport', () => {
		expect(tiersAt(1600, 1600)).toEqual([]);
		expect(tiersAt(900, 1280)).toEqual([]);
		expect(tiersAt(899, 1280)).toEqual(['narrow']);
		expect(tiersAt(699, 1280)).toEqual(['tight', 'narrow']);
		expect(tiersAt(360, 360)).toEqual(['phone', 'tight', 'narrow']);
	});
});

describe('toolbar.css', () => {
	it('uses only the widths the tiers module declares (and the 399 px step of a 360 px phone)', () => {
		const widths = new Set([...css.matchAll(/max-width:\s*(\d+)px/g)].map((m) => Number(m[1])));
		const known = new Set<number>([...Object.values(TIERS), 399]);
		for (const w of widths) expect(known.has(w), `${w}px is not a tier`).toBe(true);
		expect(widths.has(TIERS.narrow)).toBe(true);
		expect(widths.has(TIERS.phone)).toBe(true);
	});

	it('has a rule for every narrow form that changes a control', () => {
		for (const form of ['icon', 'icon-phone', 'shrink']) {
			expect(css, form).toContain(`[data-narrow='${form}']`);
		}
	});
});

describe('toolbar.css stand-ins for a label', () => {
	it('draws a stand-in icon and a short label only where the tiers say', () => {
		// Hidden by default, shown at the narrow tier (`icon`) and on a phone (`icon`, `icon-phone`).
		expect(css).toMatch(/\[data-narrow\] \.ico-stand\s*\{\s*display: none/);
		expect(css).toMatch(/\.lbl-short\s*\{\s*display: none/);
		expect(css).toMatch(/\[data-narrow='icon-phone'\]\[data-narrow\]\[data-narrow\] \.ico-stand/);
		expect(css).toMatch(/\.lbl-long\s*\{\s*display: none/);
	});
});

describe('declaring a narrow form', () => {
	it('knows the forms', () => {
		for (const f of NARROW_FORMS) expect(isNarrowForm(f)).toBe(true);
		expect(isNarrowForm('wrap')).toBe(false);
		expect(isNarrowForm(null)).toBe(false);
	});

	it('lists the controls that did not declare one', () => {
		expect(
			undeclared([
				{ name: 'Today', narrow: 'icon' },
				{ name: 'New thing', narrow: null },
				{ name: 'Other', narrow: 'huh' },
			]),
		).toEqual(['New thing', 'Other']);
	});
});

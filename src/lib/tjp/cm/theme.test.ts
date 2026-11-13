// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../../tests/grammar/corpus';

const THEME = fs.readFileSync(path.join(ROOT, 'src/lib/tjp/cm/theme.ts'), 'utf8');
const TOKENS = fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8');
const LIGHT_THEME = fs.readFileSync(path.join(ROOT, 'src/styles/theme-light.css'), 'utf8');
const DARK_THEME = fs.readFileSync(path.join(ROOT, 'src/styles/theme-dark.css'), 'utf8');

/** The custom properties a CSS block defines. */
function defined(css: string): Set<string> {
	return new Set([...css.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? ''));
}

describe('tjpTheme', () => {
	const used = new Set([...THEME.matchAll(/v\('([a-z0-9-]+)'\)/g)].map((m) => m[1] ?? ''));

	it('uses only design tokens for colours', () => {
		expect(used.size).toBeGreaterThan(10);
		expect(THEME).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		expect(THEME).not.toMatch(/rgba?\(/);
	});

	it('never dims text (stale diagnostics change only the underline style)', () => {
		// Only `opacity: '1'` is allowed: it undoes @codemirror/lint's dimmed diagnostic source label.
		expect(THEME.replace(/opacity: '1'/g, '')).not.toMatch(/opacity/);
	});

	it('uses tokens that tokens.css defines, colours in both light and dark', () => {
		const light = defined(TOKENS + LIGHT_THEME);
		const dark = defined(DARK_THEME);
		for (const name of used) {
			expect(light.has(name), name).toBe(true);
			if (name.startsWith('color-')) expect(dark.has(name), name).toBe(true);
		}
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../../tests/grammar/corpus';

const THEME = fs.readFileSync(path.join(ROOT, 'src/lib/tjp/cm/theme.ts'), 'utf8');
const TOKENS = fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8');

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
		expect(THEME).not.toMatch(/opacity/);
	});

	it('uses tokens that tokens.css defines, colours in both light and dark', () => {
		const darkStart = TOKENS.indexOf('@media (prefers-color-scheme: dark)');
		const light = defined(TOKENS.slice(0, darkStart));
		const dark = defined(TOKENS.slice(darkStart));
		for (const name of used) {
			expect(light.has(name), name).toBe(true);
			if (name.startsWith('color-')) expect(dark.has(name), name).toBe(true);
		}
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
// The self-hosted fonts (ADR-0005): their license texts ship in public/fonts/NOTICES.txt, the
// CSS points at font files that exist, and only the Latin subset is shipped.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_PACKAGES } from '../../scripts/ci/licenses.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('self-hosted fonts', () => {
	const notices = squash(read('public/fonts/NOTICES.txt'));

	it.each([...FONT_PACKAGES])('%s: its license text ships in /fonts/NOTICES.txt', (name) => {
		const license = squash(read(`node_modules/${name}/LICENSE`));
		expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
		expect(notices).toContain(license);
	});

	it('are declared as dependencies, since the built site ships them', () => {
		const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
		for (const name of FONT_PACKAGES) expect(pkg.dependencies[name]).toBeDefined();
	});

	it('are loaded from font files that exist, Latin subset only', () => {
		const css = read('src/styles/fonts.css');
		const urls = [...css.matchAll(/url\('([^']+\.woff2)'\)/g)].map((m) => m[1] ?? '');
		// Inter and JetBrains Mono (variable), Instrument Serif (regular and italic).
		expect(urls).toHaveLength(4);
		for (const u of urls) {
			expect(u).toMatch(/-latin-(wght-normal|400-normal|400-italic)\.woff2$/);
			expect(fs.existsSync(path.resolve(ROOT, 'src/styles', u))).toBe(true);
		}
	});

	it('are named in the design tokens', () => {
		const tokens = read('src/styles/tokens.css');
		expect(tokens).toMatch(/--font-sans:\s*'Inter Variable'/);
		expect(tokens).toMatch(/--font-mono:\s*'JetBrains Mono Variable'/);
		expect(tokens).toMatch(/--font-display:\s*'Instrument Serif'/);
	});
});

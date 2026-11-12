// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import { resolveBase } from './scripts/astro-base.mjs';
import { devPages } from './scripts/astro-dev-pages.mjs';

export default defineConfig({
	output: 'static',
	// "/" unless MAINSPRING_BASE is set; the GitHub Pages preview uses /mainspring/ (ADR-0006).
	base: resolveBase(),
	trailingSlash: 'ignore',
	integrations: [svelte(), devPages()],
	vite: {
		worker: { format: 'es' },
		// Emit every asset as a file; the engine assets must never be inlined.
		build: { assetsInlineLimit: 0 },
	},
});

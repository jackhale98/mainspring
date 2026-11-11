// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import { devPages } from './scripts/astro-dev-pages.mjs';

export default defineConfig({
	output: 'static',
	trailingSlash: 'ignore',
	integrations: [svelte(), devPages()],
	vite: {
		worker: { format: 'es' },
		// Emit every asset as a file; the engine assets must never be inlined.
		build: { assetsInlineLimit: 0 },
	},
});

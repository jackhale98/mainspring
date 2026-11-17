// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import { resolveBase } from './scripts/astro-base.mjs';
import { devPages } from './scripts/astro-dev-pages.mjs';
import { buildId } from './scripts/astro-build-id.mjs';

export default defineConfig({
	output: 'static',
	// "/" unless MAINSPRING_BASE is set; the GitHub Pages preview uses /mainspring/ (ADR-0006).
	base: resolveBase(),
	trailingSlash: 'ignore',
	integrations: [svelte(), devPages(), buildId()],
	vite: {
		worker: { format: 'es' },
		// Emit every asset as a file; the engine assets must never be inlined.
		build: {
			assetsInlineLimit: 0,
			rolldownOptions: {
				output: {
					// The lazy People views and details import a few components that a Gantt-first load
					// also has (the stepper, the divider, the row drag and its gestures). The bundler cuts
					// each such module out of the first load's chunk as a chunk of its own, and a dozen
					// small chunks cost the first load about 3 KB gzip against one (phase-3.md 23.1: T17
					// went from 306.6 to 309.1 / 418.1 to 420.6 KB, over the Text-first cap). One named
					// group keeps them, and what they import, in a single chunk that the first load
					// fetches anyway.
					codeSplitting: {
						groups: [
							{
								name: 'shared-ui',
								test: /[\\/]src[\\/](components[\\/](inspector[\\/]Stepper|app[\\/]SplitDivider|gantt[\\/](RowDropMarks|row-drag))|lib[\\/]gantt[\\/]reorder|lib[\\/]gesture[\\/])/,
							},
						],
					},
				},
			},
		},
	},
});

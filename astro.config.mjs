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
					// fetches anyway. Careful: the group matches the whole of src/lib/gesture/ and pulls in
					// what its modules import, so a module only a lazy view uses, placed there (or imported by
					// one of the listed modules), joins the first load. js-sizes.mjs fails a Gantt-first load
					// that fetches a People view chunk, which catches it.
					//
					// Plan health (phase-3.md section 25) adds two groups for the same reason. `core-shared`
					// holds the modules that the first load and the lazy health chunks (the checks, the
					// panel, "Why here?") all use: cut out one by one they cost the first load about 5 KB
					// gzip. `health-checks` is the chunk the first load fetches in an idle task after the
					// first result, for the Health button's count: the checks, the demand and what they read.
					// Careful, as for shared-ui: a group pulls in what its listed modules import, and a module it
					// holds joins the first load (core-shared is fetched with it, health-checks after the first
					// result). List a module in core-shared only if the first load already uses it; a module
					// only a lazy view uses, listed there or imported by a listed one, would join the first load.
					// Keep a lazy-only module out of both: `core-shared` is in the first load's static graph, and
					// the first-load sizes in js-sizes.mjs (a Gantt-first load must not fetch a People view chunk)
					// catch a mistake.
					codeSplitting: {
						groups: [
							{
								name: 'shared-ui',
								test: /[\\/]src[\\/](components[\\/](ui[\\/](Select|Menu|Popover)|inspector[\\/]Stepper|app[\\/]SplitDivider|gantt[\\/](RowDropMarks|row-drag))|lib[\\/]gantt[\\/]reorder|lib[\\/]gesture[\\/]|lib[\\/]ui[\\/](place|roving-grid))/,
							},
							{
								name: 'core-shared',
								test: /[\\/]src[\\/](lib[\\/](report|gantt[\\/](analysis|describe|grid|ticks|intents-facts)|schedule[\\/](working-time|float|graph|critical|finish|date-text|duration-text)|inspector[\\/](task|actions|field)|tjp[\\/]edit[\\/]dep-(orphans|loops|graph)|state[\\/]storage)\.ts|tjp[\\/]values[\\/]|engine[\\/]timezone\.ts)/,
							},
							{
								name: 'health-checks',
								test: /[\\/]src[\\/]lib[\\/](health[\\/](common|messages|constraints|links|people|spans|report|compute|panel-model|settings|types)|schedule[\\/](demand|explain|explain-prep|explain-text|explain-window)|workload[\\/](intervals|availability|axis)|strings-health)\.ts/,
							},
						],
					},
				},
			},
		},
	},
});

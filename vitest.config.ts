// SPDX-License-Identifier: GPL-2.0-or-later
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	// Compiles `.svelte` and `.svelte.ts` files (runes) for the state and component tests.
	plugins: [svelte()],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
		},
		// Run Svelte's client runtime, not its server build, so runes are reactive in tests.
		conditions: ['browser'],
	},
	test: {
		include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
		// P4 of the patch-fidelity suite boots the engine; `npm run test:fidelity` runs it
		// (vitest.fidelity.config.ts). Its text-only properties run here.
		exclude: [...configDefaults.exclude, 'tests/fidelity/schedule.property.test.ts'],
	},
});

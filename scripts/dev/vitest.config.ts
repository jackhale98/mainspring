// SPDX-License-Identifier: GPL-2.0-or-later
// Dev-only Vitest config for scripts/dev/*.dev.ts (needs a local TaskJuggler interpreter;
// never run in CI). Run: npx vitest run --config scripts/dev/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	root: fileURLToPath(new URL('../..', import.meta.url)),
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('../../src/lib', import.meta.url)),
		},
	},
	test: {
		include: ['scripts/dev/**/*.dev.ts'],
		testTimeout: 600_000,
	},
});

// SPDX-License-Identifier: GPL-2.0-or-later
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
		},
	},
	test: {
		include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
	},
});

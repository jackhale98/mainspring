// SPDX-License-Identifier: GPL-2.0-or-later
// `npm run test:fidelity` (phase-1.md 9.3): the patch-fidelity suite in tests/fidelity, including the P4
// engine check that `test:unit` leaves out. FIDELITY_RUNS, FIDELITY_CORPUS_RUNS, FIDELITY_SEED and
// FIDELITY_SHARD size and seed the run (tests/fidelity/config.ts). The global setup merges the parts
// the test files write into test-results/fidelity-report.{md,json}.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
		conditions: ['browser'],
	},
	test: {
		include: ['tests/fidelity/**/*.test.ts'],
		globalSetup: ['tests/fidelity/global-setup.ts'],
		// A nightly shard runs thousands of cases in one test; the suites set their own limits too.
		testTimeout: 3_600_000,
		hookTimeout: 300_000,
	},
});

// SPDX-License-Identifier: GPL-2.0-or-later
// Golden parity (npm run test:golden): Chromium only, against a build with MAINSPRING_DEV_PAGES=1.
// Kept apart from playwright.config.ts so that test:e2e stays fast.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['GOLDEN_PORT'] ?? 4322);

const launchOptions = process.env['CHROMIUM_PATH']
	? { executablePath: process.env['CHROMIUM_PATH'] }
	: {};

export default defineConfig({
	testDir: 'tests/golden',
	testMatch: 'parity.spec.ts',
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env['CI'],
	// A retry would hide state leakage, which is what this run exists to find.
	retries: 0,
	reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}/`,
		trace: 'retain-on-failure',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions } }],
	webServer: {
		command: `npm run preview -- --port ${PORT} --host localhost --ignore-lock`,
		url: `http://localhost:${PORT}/`,
		reuseExistingServer: !process.env['CI'],
	},
});

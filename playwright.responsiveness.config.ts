// SPDX-License-Identifier: GPL-2.0-or-later
// Responsiveness gate (npm run test:responsiveness): Chromium desktop only, against a build with
// MAINSPRING_DEV_PAGES=1. Kept apart from playwright.config.ts, whose build has no dev pages.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['RESPONSIVENESS_PORT'] ?? 4323);

const launchOptions = process.env['CHROMIUM_PATH']
	? { executablePath: process.env['CHROMIUM_PATH'] }
	: {};

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: 'engine-responsiveness.spec.ts',
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env['CI'],
	// A retry would hide a flaky long task, which is what this run exists to find.
	retries: 0,
	reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}/`,
		// Playwright's own trace takes DOM snapshots on the page's main thread, which would be measured.
		trace: 'off',
		screenshot: 'off',
		video: 'off',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions } }],
	webServer: {
		command: `npm run preview -- --port ${PORT} --host localhost --ignore-lock`,
		url: `http://localhost:${PORT}/`,
		reuseExistingServer: !process.env['CI'],
	},
});

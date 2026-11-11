// SPDX-License-Identifier: GPL-2.0-or-later
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 4321);

// Use a preinstalled Chromium when CHROMIUM_PATH is set (e.g. sandboxes without downloads).
const launchOptions = process.env['CHROMIUM_PATH']
	? { executablePath: process.env['CHROMIUM_PATH'] }
	: {};

export default defineConfig({
	testDir: 'tests/e2e',
	// Vitest unit tests live beside the helpers; responsiveness has its own config.
	testIgnore: ['**/*.test.ts', '**/engine-responsiveness.spec.ts'],
	fullyParallel: true,
	forbidOnly: !!process.env['CI'],
	retries: process.env['CI'] ? 1 : 0,
	reporter: process.env['CI'] ? 'github' : 'list',
	use: {
		baseURL: `http://localhost:${PORT}/`,
		trace: 'retain-on-failure',
	},
	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
		{ name: 'pixel-7', use: { ...devices['Pixel 7'], launchOptions } },
		// WebKit. Needs `playwright install webkit` (CI installs it).
		{ name: 'iphone-14', use: { ...devices['iPhone 14'] } },
	],
	webServer: {
		command: `npm run preview -- --port ${PORT} --host localhost --ignore-lock`,
		url: `http://localhost:${PORT}/`,
		reuseExistingServer: !process.env['CI'],
	},
});

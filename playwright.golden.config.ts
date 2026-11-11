// SPDX-License-Identifier: GPL-2.0-or-later
// Golden parity (npm run test:golden): against a build with MAINSPRING_DEV_PAGES=1.
// Chromium is the default and the only browser the gating CI job runs. The nightly workflow
// selects Firefox or WebKit with GOLDEN_BROWSER=firefox|webkit (scripts/test-golden.mjs
// --browser=<name>); GOLDEN_BROWSER=all defines all three, e.g. for `--list`.
// Kept apart from playwright.config.ts so that test:e2e stays fast.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['GOLDEN_PORT'] ?? 4322);

const launchOptions = process.env['CHROMIUM_PATH']
	? { executablePath: process.env['CHROMIUM_PATH'] }
	: {};

const ALL = {
	chromium: { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions } },
	firefox: { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
	webkit: { name: 'webkit', use: { ...devices['Desktop Safari'] } },
} as const;

const browser = process.env['GOLDEN_BROWSER'] || 'chromium';
if (browser !== 'all' && !(browser in ALL)) {
	throw new Error(`GOLDEN_BROWSER must be chromium, firefox, webkit or all (got "${browser}")`);
}
const projects = browser === 'all' ? Object.values(ALL) : [ALL[browser as keyof typeof ALL]];

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
	projects,
	webServer: {
		command: `npm run preview -- --port ${PORT} --host localhost --ignore-lock`,
		url: `http://localhost:${PORT}/`,
		reuseExistingServer: !process.env['CI'],
	},
});

// SPDX-License-Identifier: GPL-2.0-or-later
// The base-path test (npm run test:base-path, ADR-0006): desktop Chromium against a build with
// MAINSPRING_BASE=/mainspring/, served under that path by scripts/serve-pages.mjs the way GitHub
// Pages serves the preview. Kept apart from playwright.config.ts, whose tests run at the root base.
import { defineConfig, devices } from '@playwright/test';
import { resolveBase } from './scripts/astro-base.mjs';

const PORT = Number(process.env['BASE_PATH_PORT'] ?? 4324);
const BASE = resolveBase({ MAINSPRING_BASE: process.env['MAINSPRING_BASE'] || '/mainspring/' });
if (BASE === '/') throw new Error('the base-path test needs a base path other than "/"');

const launchOptions = process.env['CHROMIUM_PATH']
	? { executablePath: process.env['CHROMIUM_PATH'] }
	: {};

export default defineConfig({
	testDir: 'tests/base-path',
	testMatch: '*.spec.ts',
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env['CI'],
	retries: process.env['CI'] ? 1 : 0,
	reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
	use: {
		// Tests navigate with relative URLs ("app"), which resolve under the base.
		baseURL: `http://localhost:${PORT}${BASE}`,
		trace: 'retain-on-failure',
	},
	projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } }],
	webServer: {
		command: `node scripts/serve-pages.mjs --dir dist --base ${BASE} --port ${PORT} --host localhost`,
		url: `http://localhost:${PORT}${BASE}`,
		reuseExistingServer: !process.env['CI'],
	},
});

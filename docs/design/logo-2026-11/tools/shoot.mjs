// SPDX-License-Identifier: GPL-2.0-or-later
// Logo exploration (docs/design/logo-2026-11): screenshots of the real app and landing page with
// each variant swapped in. The swap is a temporary local edit (see README); this script only
// expects three dev servers: current on 4401, a-flow on 4402, b-spring on 4403.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const root = new URL('../', import.meta.url).pathname;
mkdirSync(`${root}mockups/raw`, { recursive: true });
const variants = { current: 4401, a: 4402, b: 4403 };
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(launchOptions);

const setups = {
	desktop: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
	phone: { ...devices['Pixel 7'] },
};

for (const [vid, port] of Object.entries(variants)) {
	for (const theme of ['light', 'dark']) {
		for (const [dev, opts] of Object.entries(setups)) {
			const ctx = await browser.newContext({ ...opts, colorScheme: theme, reducedMotion: 'reduce' });
			const page = await ctx.newPage();
			const base = `http://127.0.0.1:${port}/`;
			const name = `${vid}-${theme}-${dev}`;
			// landing page
			await page.goto(base, { waitUntil: 'networkidle' });
			await page.evaluate(() => document.fonts.ready);
			await page.waitForTimeout(500);
			await page.screenshot({ path: `${root}mockups/raw/${name}-landing.png` });
			// app
			await page.goto(`${base}app/`, { waitUntil: 'load' });
			console.log('app', name);
			await page.waitForSelector('.topbar', { state: 'attached', timeout: 30000 });
			await page.waitForTimeout(4000);
			await page.evaluate(() => document.fonts.ready);
			await page.waitForTimeout(1500);
			await page.screenshot({ path: `${root}mockups/raw/${name}-app.png` });
			await ctx.close();
			console.log('shot', name);
		}
	}
}
await browser.close();

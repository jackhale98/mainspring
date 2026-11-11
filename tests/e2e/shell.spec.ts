// SPDX-License-Identifier: GPL-2.0-or-later
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { REPO, loadCorpus, planRequest } from '../golden/corpus';

// A cold engine boot (ruby.wasm and the TaskJuggler files) is several seconds; CI and WebKit are slower.
const READY_TIMEOUT_MS = 120_000;
const SCREENSHOT_DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-0');

test.describe('app shell', () => {
	test('shows the app name and engine status', async ({ page }) => {
		await page.goto('/app');
		await expect(page.getByRole('heading', { level: 1, name: 'Mainspring' })).toBeVisible();
		await expect(page.getByTestId('engine-status')).toHaveText(/^Engine: \S/);
	});

	test('the engine reaches Ready', async ({ page }) => {
		await page.goto('/app');
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
	});

	test('has no horizontal scroll', async ({ page }) => {
		await page.goto('/app');
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`has no axe violations (${scheme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto('/app');
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			// Check both the booting text and the Ready text.
			for (const status of ['booting', 'ready']) {
				if (status === 'ready') {
					await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
						timeout: READY_TIMEOUT_MS,
					});
				}
				const results = await new AxeBuilder({ page })
					.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
					.analyze();
				expect(results.violations, status).toEqual([]);
			}
		});
	}
});

test.describe('engine on the dev page', () => {
	test('schedules the PoC sample: ok, 13 tasks', async ({ page }) => {
		test.setTimeout(READY_TIMEOUT_MS + 60_000);
		const entry = loadCorpus().find((e) => e.plan.id === 'poc-sample');
		if (!entry) throw new Error('poc-sample is not in the golden manifest');
		const request = planRequest(entry.plan, entry.golden, 1);

		// Needs a build with MAINSPRING_DEV_PAGES=1; a 404 here fails the test on purpose.
		const response = await page.goto('/dev/engine');
		expect(response?.status(), 'is the site built with MAINSPRING_DEV_PAGES=1?').toBe(200);
		const outcome = await page.evaluate(async (req) => {
			const api = window.mainspringDev;
			if (!api) throw new Error('window.mainspringDev is missing');
			await api.ready();
			return api.schedule(req);
		}, request);

		expect(outcome.status).toBe('done');
		if (outcome.status !== 'done') return;
		expect(outcome.result.ok).toBe(true);
		expect(outcome.result.tasks).toHaveLength(13);
		expect(
			outcome.result.messages.filter((m) => m.level === 'error' || m.level === 'fatal'),
		).toEqual([]);
	});
});

// Phase-0 gate screenshots, written only when SCREENSHOTS=1 so that normal runs leave the repo alone.
test.describe('gate screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to refresh docs/phases/screenshots');

	async function shoot(page: import('@playwright/test').Page, file: string): Promise<void> {
		await page.goto('/app');
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await page.screenshot({ path: path.join(SCREENSHOT_DIR, file) });
	}

	test.describe('desktop', () => {
		test.use({ deviceScaleFactor: 2 });
		test('app-desktop.png', async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await shoot(page, 'app-desktop.png');
		});
	});

	test('app-phone.png and app-phone-dark.png', async ({ page }, info) => {
		test.skip(info.project.name !== 'pixel-7');
		await shoot(page, 'app-phone.png');
		await page.emulateMedia({ colorScheme: 'dark' });
		await shoot(page, 'app-phone-dark.png');
	});
});

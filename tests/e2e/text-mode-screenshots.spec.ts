// SPDX-License-Identifier: GPL-2.0-or-later
// Phase-1 gate screenshots of Text mode, written only when SCREENSHOTS=1 so that normal runs
// leave the repository alone. Desktop at device scale factor 2; phones through device emulation.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-1');

test.describe('text mode screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to refresh docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	async function open(page: Page, sample: string): Promise<void> {
		await page.goto(`/app?sample=${sample}`);
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready');
		// Let the web fonts and the first paint settle.
		await page.waitForTimeout(500);
	}

	async function breakPlan(page: Page): Promise<void> {
		await page.getByRole('textbox', { name: /^Editor for / }).click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.insertText('\n}\n');
		await expect(page.locator('.cm-lintRange-error').first()).toBeVisible();
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('last good', {
			timeout: READY_TIMEOUT_MS,
		});
	}

	test.describe('desktop', () => {
		test.use({ deviceScaleFactor: 2 });

		test('app-desktop.png', async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await page.setViewportSize({ width: 1280, height: 800 });
			await open(page, 'upstream-tutorial');
			await page.screenshot({ path: path.join(DIR, 'app-desktop.png') });
		});

		test('app-desktop-dark.png', async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.emulateMedia({ colorScheme: 'dark' });
			await open(page, 'upstream-tutorial');
			await breakPlan(page);
			await page.screenshot({ path: path.join(DIR, 'app-desktop-dark.png') });
		});

		test('app-tablet.png and the drawer', async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await page.setViewportSize({ width: 820, height: 1180 });
			await open(page, 'syn-18-structure-include-macro');
			await page.screenshot({ path: path.join(DIR, 'app-tablet.png') });
			// The tutorial has longer lines, so the editor behind the drawer shows more.
			await page.goto('/app?sample=upstream-tutorial');
			await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
				timeout: READY_TIMEOUT_MS,
			});
			await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready');
			await page.getByRole('button', { name: 'Outline' }).click();
			await expect(page.getByRole('dialog', { name: 'Outline' })).toBeVisible();
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(DIR, 'app-tablet-drawer.png') });
		});
	});

	test('app-phone-text.png, app-phone-plan.png and the docs sheet', async ({ page }, info) => {
		test.skip(info.project.name !== 'pixel-7');
		await open(page, 'syn-18-structure-include-macro');
		await page.screenshot({ path: path.join(DIR, 'app-phone-text.png') });
		await page.getByRole('tab', { name: 'Plan', exact: true }).click();
		await page.screenshot({ path: path.join(DIR, 'app-phone-plan.png') });
		await page.getByRole('tab', { name: 'Text', exact: true }).click();
		await page.locator('.cm-line', { hasText: /^project / }).click({ position: { x: 4, y: 4 } });
		await page.getByRole('button', { name: 'Docs' }).click();
		await expect(page.getByRole('dialog', { name: 'Documentation' })).toBeVisible();
		await page.waitForTimeout(400);
		await page.screenshot({ path: path.join(DIR, 'app-phone-docs.png') });
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
// Phase-2 T14 screenshots of the app frame in the "Mainspring refined" design (CLAUDE.md "Mobile
// counts"), written only when SCREENSHOTS=1 so that normal runs leave the repository alone.
// Desktop Split and Visual and the tablet through viewport sizes at device scale factor 2, the
// phone through Pixel 7 emulation; each in light and dark.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');
const TUTORIAL = 'upstream-tutorial';
const FEDORA = 'upstream-fedora-20';

test.describe('ui screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to refresh docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	async function open(page: Page, sample: string, mode?: string): Promise<void> {
		const text = mode === 'text';
		await page.goto(`/app?sample=${sample}${mode ? `&mode=${mode}` : ''}`);
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		if (text) {
			await expect(page.getByRole('textbox', { name: /^Editor for / })).toBeVisible();
			await page.waitForTimeout(500);
			return;
		}
		await expect(page.getByTestId('gantt')).toBeVisible();
		await expect(page.locator('[role="row"][data-key]').first()).toBeVisible();
		// Bars appear with the first result; let the fonts and the first paint settle.
		await page.waitForTimeout(800);
	}

	const shot = (page: Page, name: string) => page.screenshot({ path: path.join(DIR, name) });

	for (const scheme of ['light', 'dark'] as const) {
		test.describe(`desktop ${scheme}`, () => {
			test.use({ deviceScaleFactor: 2 });

			test(`ui-desktop-split-${scheme}.png`, async ({ page }, info) => {
				test.skip(info.project.name !== 'desktop');
				await page.setViewportSize({ width: 1440, height: 860 });
				await page.emulateMedia({ colorScheme: scheme });
				await open(page, TUTORIAL, 'split');
				await page
					.locator('[role="row"][data-key]', { hasText: /Project/ })
					.first()
					.click();
				await page.waitForTimeout(300);
				await shot(page, `ui-desktop-split-${scheme}.png`);
			});

			test(`ui-desktop-visual-${scheme}.png`, async ({ page }, info) => {
				test.skip(info.project.name !== 'desktop');
				await page.setViewportSize({ width: 1440, height: 860 });
				await page.emulateMedia({ colorScheme: scheme });
				await open(page, FEDORA, 'visual');
				await shot(page, `ui-desktop-visual-${scheme}.png`);
			});

			test(`ui-desktop-text-${scheme}.png`, async ({ page }, info) => {
				test.skip(info.project.name !== 'desktop');
				await page.setViewportSize({ width: 1440, height: 860 });
				await page.emulateMedia({ colorScheme: scheme });
				await open(page, TUTORIAL, 'text');
				await expect(page.getByRole('textbox', { name: /^Editor for / })).toBeVisible();
				await shot(page, `ui-desktop-text-${scheme}.png`);
			});
		});

		test(`ui-tablet-${scheme}.png`, async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await page.setViewportSize({ width: 820, height: 1180 });
			await page.emulateMedia({ colorScheme: scheme });
			await open(page, TUTORIAL, 'visual');
			await shot(page, `ui-tablet-${scheme}.png`);
			await page.getByRole('button', { name: 'Split' }).click();
			await expect(page.getByRole('separator')).toBeVisible();
			await page.waitForTimeout(500);
			await shot(page, `ui-tablet-split-${scheme}.png`);
		});

		test(`ui-pixel7-${scheme}.png`, async ({ page }, info) => {
			test.skip(info.project.name !== 'pixel-7');
			await page.emulateMedia({ colorScheme: scheme });
			await open(page, TUTORIAL);
			await shot(page, `ui-pixel7-gantt-${scheme}.png`);
			await page.locator('[role="row"][data-key]').nth(2).click();
			await page.waitForTimeout(300);
			await shot(page, `ui-pixel7-gantt-selected-${scheme}.png`);
			await page.getByRole('tab', { name: 'Text', exact: true }).click();
			await expect(page.getByRole('textbox', { name: /^Editor for / })).toBeVisible();
			await page.waitForTimeout(400);
			await shot(page, `ui-pixel7-text-${scheme}.png`);
			await page.getByRole('tab', { name: 'Plan', exact: true }).click();
			await page.waitForTimeout(300);
			await shot(page, `ui-pixel7-plan-${scheme}.png`);
		});
	}

	// The phone's Text tab on the manipulation sample: the picture the review asked for.
	test('sample-picker-phone-pixel7-light.png', async ({ page }, info) => {
		test.skip(info.project.name !== 'pixel-7');
		await page.emulateMedia({ colorScheme: 'light' });
		await open(page, 'gantt-manipulation', 'text');
		await expect(page.getByRole('textbox', { name: /^Editor for / })).toBeVisible();
		await page.waitForTimeout(400);
		await shot(page, 'sample-picker-phone-pixel7-light.png');
	});
});

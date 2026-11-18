// SPDX-License-Identifier: GPL-2.0-or-later
// The screenshots of the shared primitives on /dev/primitives (SCREENSHOTS=1; ADR-0016 #3), light and
// dark, desktop and the Pixel 7 emulation: docs/phases/screenshots/phase-3/t25-<primitive>-<device>-<scheme>.png.
// Without SCREENSHOTS=1 the tests pass without taking a picture. Run it with --project=desktop and
// --project=pixel-7 (the iPhone's pictures are not kept).
import path from 'node:path';
import { test, type Locator, type Page } from '@playwright/test';
import { REPO } from '../../golden/corpus';
import { deviceName } from '../lib/gantt-rig';
import { openPrimitives } from '../lib/primitives-rig';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

/** Takes the picture when asked for (the file name is empty otherwise). */
async function shot(target: Page | Locator, file: string): Promise<void> {
	if (file === '') return;
	await target.screenshot({ path: file });
}

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`primitives pictures (${scheme})`, () => {
		let file: (page: Page, name: string) => string;
		test.beforeEach(async ({ page }, info) => {
			const device = deviceName(info);
			file = (_p, name) =>
				process.env['SCREENSHOTS'] ? path.join(DIR, `t25-${name}-${device}-${scheme}.png`) : '';
			await openPrimitives(page, scheme);
		});

		test('sheet', async ({ page }) => {
			await page.getByTestId('open-details').click();
			await page.waitForTimeout(700);
			await shot(page, file(page, 'sheet'));
		});

		test('menu', async ({ page }, info) => {
			const touch = deviceName(info) !== 'desktop';
			const id = touch ? 'menu-sheet-trigger' : 'menu-end';
			await page.getByTestId(id).evaluate((el) => el.scrollIntoView({ block: 'center' }));
			await page.waitForTimeout(150);
			await page.getByTestId(id).click();
			await page.waitForTimeout(600);
			await shot(page, file(page, 'menu'));
		});

		test('select', async ({ page }) => {
			await page.getByTestId('prim-select').scrollIntoViewIfNeeded();
			await shot(page.getByTestId('prim-select'), file(page, 'select'));
		});

		test('popover', async ({ page }) => {
			await page
				.getByTestId('pop-anchor-button')
				.evaluate((el) => el.scrollIntoView({ block: 'center' }));
			await page.waitForTimeout(150);
			await page.getByTestId('pop-anchor-button').click();
			await page.waitForTimeout(400);
			await shot(page, file(page, 'popover'));
		});

		test('toolbar', async ({ page }) => {
			await page.evaluate(() => {
				(window as unknown as { __primitives: { picker(on: boolean): void } }).__primitives.picker(
					innerWidth > 599,
				);
			});
			await page.getByTestId('prim-toolbar').scrollIntoViewIfNeeded();
			await page.waitForTimeout(300);
			await shot(page.getByTestId('prim-toolbar'), file(page, 'toolbar'));
		});

		test('grid-focus', async ({ page }) => {
			await page.locator('[data-testid="roving-cell"][data-row="1"][data-col="1"]').focus();
			await page.getByTestId('prim-grid').scrollIntoViewIfNeeded();
			await shot(page.getByTestId('prim-grid'), file(page, 'grid-focus'));
		});
	});
}

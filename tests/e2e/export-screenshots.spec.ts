// SPDX-License-Identifier: GPL-2.0-or-later
// Pictures of the export (SCREENSHOTS=1; phase-4.md 18.20, T18), light and dark, on the desktop, the
// Pixel 7 and the iPhone 14: the "More actions" menu with the two export entries, and the PNG the
// export makes of the chart: docs/phases/screenshots/phase-4/t18-export-<what>-<device>-<scheme>.png.
// Without SCREENSHOTS=1 the tests are skipped (each boots the engine).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, deviceName } from './lib/gantt-rig';
import { bytesOf, download, openMenu, openPlan, withoutClipboardItem } from './lib/export-rig';
import { pictureReady } from './lib/settle';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-4');
test.setTimeout(READY_TIMEOUT_MS * 2);
test.skip(!process.env['SCREENSHOTS'], 'pictures only on request');

const file = (what: string, info: TestInfo, scheme: string): string =>
	path.join(DIR, `t18-export-${what}-${deviceName(info)}-${scheme}.png`);

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`export (${scheme})`, () => {
		test.beforeEach(async ({ page }) => {
			fs.mkdirSync(DIR, { recursive: true });
			await page.emulateMedia({ colorScheme: scheme });
		});

		test('the menu with the export entries', async ({ page }, info) => {
			const rig = await openPlan(page, info);
			// A task selected, so that the row actions beside the exports are on.
			await rig.row('task:design.research').locator('.label').click();
			await pictureReady(page);
			const menu = await openMenu(page, info);
			// On a short phone the list scrolls: the entries are shown where a finger would scroll to.
			await menu.getByRole('menuitem', { name: 'Keyboard shortcuts' }).scrollIntoViewIfNeeded();
			await expect(menu.getByRole('menuitem', { name: 'Export tasks as CSV' })).toBeInViewport();
			await pictureReady(page);
			await page.screenshot({ path: file('menu', info, scheme) });
		});

		test('the menu with no task selected', async ({ page }, info) => {
			await openPlan(page, info);
			await pictureReady(page);
			const menu = await openMenu(page, info);
			await menu.getByRole('menuitem', { name: 'Keyboard shortcuts' }).scrollIntoViewIfNeeded();
			await expect(menu.getByRole('menuitem', { name: 'Copy Gantt as image' })).toBeInViewport();
			await pictureReady(page);
			await page.screenshot({ path: file('menu-none', info, scheme) });
		});

		test('the picture the export makes', async ({ page }, info) => {
			await withoutClipboardItem(page);
			await openPlan(page, info);
			await pictureReady(page);
			const png = await bytesOf(await download(page, info, 'Copy Gantt as image'));
			fs.writeFileSync(file('gantt', info, scheme), png);
			expect(png.length).toBeGreaterThan(1000);
		});
	});
}

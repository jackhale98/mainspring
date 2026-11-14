// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots of the Add task (+) control (phase-3.md T3), light and dark, on the desktop (1440 x
// 860, device scale factor 2) and the Pixel 7 emulation (its own scale factor): the toolbar with
// nothing selected, the toolbar with a task selected and the two-item menu open, and the details
// open on the new task with its name focused. Run with SCREENSHOTS=1; it writes
// docs/phases/screenshots/phase-3/add-task-<what>-<device>-<light|dark>.png.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig } from './lib/gantt-rig';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

test.describe('add task screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS * 2);

	async function shoot(page: Page, device: string, what: string): Promise<void> {
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(DIR, `add-task-${what}-${device}-${scheme}.png`) });
		}
		await page.emulateMedia({ colorScheme: 'light' });
		await page.waitForTimeout(200);
	}

	async function run(page: Page, info: Parameters<typeof Rig.open>[1], device: string) {
		if (device === 'desktop') await page.setViewportSize({ width: 1440, height: 860 });
		const rig = await Rig.open(page, info);
		await shoot(page, device, 'toolbar-idle');

		const label = rig.row('task:launch').locator('.label');
		if (device === 'desktop') await label.click();
		else await label.tap();
		await expect(rig.row('task:launch')).toHaveAttribute('aria-selected', 'true');
		const add = page.getByTestId('add-task');
		if (device === 'desktop') await add.click();
		else await add.tap();
		await expect(page.getByRole('menuitem', { name: 'Add subtask' })).toBeVisible();
		await shoot(page, device, 'toolbar-menu');

		const after = page.getByRole('menuitem', { name: 'Add task after' });
		if (device === 'desktop') await after.click();
		else await after.tap();
		await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused({
			timeout: READY_TIMEOUT_MS,
		});
		await page.waitForTimeout(600);
		await shoot(page, device, 'details');
	}

	test.describe('desktop', () => {
		test.use({ deviceScaleFactor: 2 });
		test('toolbar and details', async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await run(page, info, 'desktop');
		});
	});

	test.describe('pixel 7', () => {
		test('toolbar and details', async ({ page }, info) => {
			test.skip(info.project.name !== 'pixel-7');
			await run(page, info, 'pixel-7');
		});
	});
});

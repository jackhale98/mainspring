// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots of the people picker (polish item 17), light and dark, at device scale factor 2.
// Desktop (1280 x 720, the "Fedora with people" sample): the toolbar with the Assign control, the
// list open and filtered, assign mode active; and 1920 x 1000 with the details hidden, where the
// recent chips show their names. Pixel 7: the Gantt, to show the phone is unchanged. Run with
// SCREENSHOTS=1; it writes docs/phases/screenshots/phase-3/polish-17-<what>-<device>-<light|dark>.png.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig } from './lib/gantt-rig';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

test.describe('people picker screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.use({ deviceScaleFactor: 2 });

	async function shoot(page: Page, device: string, what: string): Promise<void> {
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(DIR, `polish-17-${what}-${device}-${scheme}.png`) });
		}
		await page.emulateMedia({ colorScheme: 'light' });
		await page.waitForTimeout(200);
	}

	test('desktop: toolbar, list filtered, assign mode', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop');
		await page.setViewportSize({ width: 1280, height: 720 });
		const rig = await Rig.open(page, info, 'month', 'visual', 'fedora-res');
		await shoot(page, 'desktop', 'toolbar');

		await rig.openPeople();
		await page.keyboard.type('doc');
		await expect(page.getByRole('listbox', { name: 'People' }).getByRole('option')).toHaveCount(6);
		await page.keyboard.press('ArrowDown');
		await shoot(page, 'desktop', 'list-filtered');

		await page.getByRole('option', { name: /Documentation 02/ }).click();
		await expect(page.getByTestId('assign-mode')).toContainText('Assigning Documentation 02');
		const bar = page.getByTestId('gantt-overlay');
		const box = await bar.boundingBox();
		if (!box) throw new Error('no chart');
		// The cursor is not in a screenshot: the pointer rests over the chart.
		await page.mouse.move(box.x + box.width * 0.5, box.y + 200);
		await shoot(page, 'desktop', 'assign-mode');
	});

	test('desktop wide: the recent chips', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop');
		await page.setViewportSize({ width: 1920, height: 1000 });
		const rig = await Rig.open(page, info, 'month', 'visual', 'fedora-res');
		await page.getByRole('button', { name: 'Hide details' }).click();
		for (const id of ['docs01', 'qa03', 'server02']) {
			await rig.openPeople();
			await rig.personOption(id).click();
			await page.getByRole('button', { name: 'Done assigning' }).click();
		}
		await expect(page.locator('.recent .name')).toHaveText([
			'Server 02',
			'Quality 03',
			'Documentation 01',
		]);
		await page.mouse.move(10, 10);
		await shoot(page, 'desktop-wide', 'recent');
	});

	test('pixel 7: the Gantt is unchanged (no Assign control)', async ({ page }, info) => {
		test.skip(info.project.name !== 'pixel-7');
		await Rig.open(page, info, 'week', 'visual', 'fedora-res');
		await expect(page.getByTestId('assign-button')).toBeHidden();
		await shoot(page, 'pixel-7', 'gantt');
	});
});

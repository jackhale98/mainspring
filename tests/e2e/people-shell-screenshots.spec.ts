// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots of the People shell (phase-3.md T13), light and dark, on the desktop (the view
// switcher over the Gantt and over Workload, "No people") and the Pixel 7 emulation (the People tab
// with its segments, "No people"), and the switcher on an 820 px tablet (light). Run with
// SCREENSHOTS=1; it writes docs/phases/screenshots/phase-3/t13-<what>-<device>-<light|dark>.png.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, deviceName, isTouch } from './lib/gantt-rig';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

test.describe('people shell screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14');
	});

	async function shoot(page: Page, device: string, what: string): Promise<void> {
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(DIR, `t13-${what}-${device}-${scheme}.png`) });
		}
		await page.emulateMedia({ colorScheme: 'light' });
		await page.waitForTimeout(200);
	}

	async function open(page: Page, plan = 'upstream-tutorial'): Promise<void> {
		await page.goto(`/app?sample=${plan}&mode=visual`);
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
	}

	async function newPlan(page: Page, touch: boolean): Promise<void> {
		const sheet = page.getByRole('dialog', { name: 'New plan' });
		await page.getByLabel('Sample plan').selectOption({ label: 'New plan…' });
		await sheet.getByLabel('Name', { exact: true }).fill('Website relaunch');
		const create = sheet.getByRole('button', { name: 'Create' });
		if (touch) await create.tap();
		else await create.click();
		await expect(sheet).toBeHidden();
	}

	const viewTab = (page: Page, name: string) =>
		page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name });
	const peopleTab = (page: Page) =>
		page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' });

	test('desktop: the view switcher over the Gantt and over Workload, and "No people"', async ({
		page,
	}, info) => {
		test.skip(isTouch(info));
		const device = deviceName(info);
		await open(page);
		await shoot(page, device, 'view-switcher-gantt');
		await viewTab(page, 'Workload').click();
		await expect(page.getByTestId('people-coming')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await shoot(page, device, 'view-switcher-workload');
		await newPlan(page, false);
		await viewTab(page, 'Workload').click();
		await expect(page.getByTestId('no-people')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await shoot(page, device, 'no-people');
	});

	test('desktop: the switcher on a tablet width', async ({ page }, info) => {
		test.skip(isTouch(info));
		await page.setViewportSize({ width: 820, height: 1000 });
		await open(page);
		await viewTab(page, 'Resources').click();
		await expect(page.getByTestId('people-coming')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await page.waitForTimeout(400);
		await page.screenshot({ path: path.join(DIR, 't13-view-switcher-tablet-820-light.png') });
	});

	test('phone: the People tab with its segments, and "No people"', async ({ page }, info) => {
		test.skip(!isTouch(info));
		const device = deviceName(info);
		await open(page);
		await peopleTab(page).tap();
		await expect(page.getByTestId('people-coming')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await shoot(page, device, 'people-tab-load');
		await page
			.getByRole('tablist', { name: 'People views' })
			.getByRole('tab', { name: 'Team' })
			.tap();
		await shoot(page, device, 'people-tab-team');
		await newPlan(page, true);
		await peopleTab(page).tap();
		await expect(page.getByTestId('no-people')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await shoot(page, device, 'no-people');
	});
});

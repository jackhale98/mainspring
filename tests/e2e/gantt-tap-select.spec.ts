// SPDX-License-Identifier: GPL-2.0-or-later
// Select first, open on a second tap (sheet layouts), and one click on a desktop. On a phone or a
// tablet a first tap on a task selects it (the bar is highlighted, its handles show) and leaves the
// chart in full view; a tap on the selected task opens the details sheet; with the sheet open a tap
// on another task switches it; a drop never opens it. A desktop keeps its docked panel and shows the
// details after one click. Assertions are engine independent (roles, aria-selected, the sheet's
// visibility). With SCREENSHOTS=1 it writes docs/phases/screenshots/phase-2/tap-select-<device>-
// <light|dark>.png (after the first tap) and tap-select-open-<device>-<light|dark>.png (after the
// second).
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig, deviceName, isTouch, minute } from './lib/gantt-rig';

const SHOTS = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');

const sheet = (page: Page) => page.getByRole('dialog', { name: /Task details/ });

async function shoot(page: Page, info: TestInfo, what: string): Promise<void> {
	if (process.env['SCREENSHOTS'] !== '1') return;
	const device = deviceName(info);
	await page.screenshot({ path: path.join(SHOTS, `${what}-${device}-light.png`) });
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.waitForTimeout(250);
	await page.screenshot({ path: path.join(SHOTS, `${what}-${device}-dark.png`) });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.waitForTimeout(150);
}

test.describe('tap to select, tap again to open (sheet layouts)', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(!isTouch(info), 'phones and tablets; the desktop test is below');
	});

	test('a first tap selects, the link dot works with no sheet, a second tap opens', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info, 'week');
		const b = await rig.bar('design.research');
		await rig.tap(b.body);

		// Selected: the row says so, its handles are there, and no sheet covers the chart.
		await expect(rig.row('task:design.research')).toHaveAttribute('aria-selected', 'true');
		await expect(sheet(page)).toHaveCount(0);
		await expect(
			page.getByRole('status').filter({ hasText: 'Selected Research. Tap again for details.' }),
		).toHaveCount(1);
		await shoot(page, info, 'tap-select');

		// The handles work as they are: tap the link dot, linking starts, still no sheet.
		const sel = await rig.peek('design.research');
		await rig.tap(sel.dot);
		await expect(page.getByTestId('link-banner')).toContainText('Linking from Research');
		await expect(sheet(page)).toHaveCount(0);
		await page.getByTestId('link-banner').getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByTestId('link-banner')).toHaveCount(0);

		// A tap on the selected task opens the details.
		await rig.tap((await rig.peek('design.research')).body);
		await expect(sheet(page)).toBeVisible();
		await expect(sheet(page).getByLabel('Name', { exact: true })).toHaveValue('Research');
		await page.waitForTimeout(500);
		await shoot(page, info, 'tap-select-open');
	});

	test('with the sheet open, a tap on another task switches it and keeps it open', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info, 'week');
		const b = await rig.bar('design.research');
		await rig.tap(b.body);
		await rig.tap((await rig.peek('design.research')).body);
		await expect(sheet(page).getByLabel('Name', { exact: true })).toHaveValue('Research');

		// Another task, from its row in the task list: selected, and the sheet shows it.
		await rig.row('task:design.review').click();
		await expect(rig.row('task:design.review')).toHaveAttribute('aria-selected', 'true');
		await expect(sheet(page).getByLabel('Name', { exact: true })).toHaveValue('Review');
	});

	test('a first tap on a row selects only, a second opens', async ({ page }, info) => {
		const rig = await Rig.open(page, info, 'week');
		await rig.row('task:design.review').click();
		await expect(rig.row('task:design.review')).toHaveAttribute('aria-selected', 'true');
		await expect(sheet(page)).toHaveCount(0);
		await page.waitForTimeout(600);
		await rig.row('task:design.review').click();
		await expect(sheet(page).getByLabel('Name', { exact: true })).toHaveValue('Review');
	});

	test('a quick double tap on a name opens the details, not a rename', async ({ page }, info) => {
		const rig = await Rig.open(page, info, 'week');
		await rig.row('task:design.review').getByText('Review', { exact: true }).dblclick();
		await expect(sheet(page).getByLabel('Name', { exact: true })).toHaveValue('Review');
		await expect(rig.row('task:design.review').locator('input')).toHaveCount(0);
	});

	test('a drop selects the dragged task and does not open the sheet', async ({ page }, info) => {
		const rig = await Rig.open(page, info, 'week');
		const b = await rig.bar('design.research');
		const to = { x: b.body.x + (await rig.x(minute('2026-03-05', 9))) - b.box.x, y: b.body.y };
		await rig.drag(b.body, to, { hold: rig.hold });
		const ask = page.getByTestId('move-question');
		await expect(ask).toBeVisible();
		await expect(rig.row('task:design.research')).toHaveAttribute('aria-selected', 'true');
		await expect(sheet(page)).toHaveCount(0);
		await ask.getByRole('button', { name: 'Cancel' }).click();
		await expect(ask).toBeHidden();
		await expect(sheet(page)).toHaveCount(0);
	});
});

test.describe('one click on a desktop', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test('a click on a bar selects it and shows its details in the panel', async ({ page }, info) => {
		test.skip(isTouch(info), 'the desktop layout');
		const rig = await Rig.open(page, info);
		const b = await rig.bar('design.research');
		await rig.tap(b.body);
		await expect(rig.row('task:design.research')).toHaveAttribute('aria-selected', 'true');
		const panel = page.getByRole('complementary', { name: 'Details' });
		await expect(panel.getByLabel('Name', { exact: true })).toHaveValue('Research');
	});
});

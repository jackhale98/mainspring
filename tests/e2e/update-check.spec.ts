// SPDX-License-Identifier: GPL-2.0-or-later
// A newer deployed build offers a reload (ADR-0012). The build writes version.json with its id;
// here the server is made to answer with another id, as after a deploy.
import { expect, test } from '@playwright/test';
import path from 'node:path';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join('docs', 'phases', 'screenshots', 'phase-2');

test.describe('update check', () => {
	test.setTimeout(READY_TIMEOUT_MS + 30_000);

	test('the build is current, so nothing is offered', async ({ page }) => {
		const res = await page.request.get('version.json');
		expect(res.ok()).toBe(true);
		const own = (await res.json()) as { id: string };
		expect(own.id).toMatch(/^[0-9a-z]+-\d{12}$/);
		await page.goto('app?sample=upstream-tutorial');
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await page.waitForTimeout(4_000);
		await expect(page.getByTestId('update-reload')).toHaveCount(0);
	});

	test('a newer deployed build shows Reload, which reloads the page', async ({ page }, info) => {
		await page.route('**/version.json*', (route) =>
			route.fulfill({ json: { id: 'ffffffff-209912312359', builtAt: '2099-12-31T23:59:00Z' } }),
		);
		await page.goto('app?sample=upstream-tutorial');
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		const reload = page.getByRole('button', { name: /new version of Mainspring is available/ });
		await expect(reload).toBeVisible({ timeout: 10_000 });
		if (info.project.name === 'desktop' || info.project.name === 'pixel-7') {
			const shot = info.project.name === 'desktop' ? 'desktop' : 'pixel7';
			await page.screenshot({ path: path.join(DIR, `update-${shot}-light.png`) });
			await page.getByTestId('engine-info').click();
			await expect(page.getByTestId('engine-info-details')).toContainText('New version');
			await page.screenshot({ path: path.join(DIR, `update-${shot}-popover-light.png`) });
			await page.keyboard.press('Escape');
		}
		const loaded = page.waitForEvent('load');
		await reload.click();
		await loaded;
		await expect(page.getByRole('group', { name: 'Plan status' })).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});
	});
});

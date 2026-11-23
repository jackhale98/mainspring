// SPDX-License-Identifier: GPL-2.0-or-later
// Pictures of the plans kept in the browser (SCREENSHOTS=1; phase-4.md 7.1, 9.4, T4), light and
// dark: the footer's line once a sample's copy is kept (desktop and a tablet-sized desktop), the
// read-only notice of a second page with "Open here instead" (desktop, Pixel 7, iPhone 14), and the
// notice that the browser cleared its plans (the phones, where no footer line is):
// docs/phases/screenshots/phase-4/t4-<what>-<device>-<scheme>.png. Without SCREENSHOTS=1 the tests
// are skipped (each boots the engine).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { strings } from '../../src/lib/strings';
import { REPO } from '../golden/corpus';
import { deviceName, isTouch } from './lib/gantt-rig';
import { modKey } from './lib/keys';
import { pictureReady } from './lib/settle';
import { READY_TIMEOUT_MS, editor } from './lib/text-mode';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-4');
test.setTimeout(READY_TIMEOUT_MS * 2 + 60_000);
test.skip(!process.env['SCREENSHOTS'], 'pictures only on request');

const file = (what: string, info: TestInfo, scheme: string, device = deviceName(info)): string =>
	path.join(DIR, `t4-${what}-${device}-${scheme}.png`);

async function open(page: Page, mode: 'text' | 'visual'): Promise<void> {
	await page.goto(`/app?sample=ui-basic&mode=${mode}`);
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
}

/** A change in the editor stores the sample's copy (the address then drops `?sample=`). */
async function keepCopy(page: Page): Promise<void> {
	await editor(page).click();
	await page.keyboard.press(`${await modKey(page)}+Home`);
	await page.keyboard.insertText('# kept\n');
	await expect(page).not.toHaveURL(/[?&]sample=/, { timeout: 10_000 });
}

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`plans kept in the browser (${scheme})`, () => {
		test.beforeEach(async ({ page }) => {
			fs.mkdirSync(DIR, { recursive: true });
			await page.emulateMedia({ colorScheme: scheme });
		});

		test('the footer line of a kept plan', async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop', 'phones have no footer line');
			await open(page, 'text');
			await keepCopy(page);
			await page.getByRole('button', { name: 'Visual', exact: true }).click();
			await expect(page.getByTestId('keep-line')).toHaveText(strings.keep.stored);
			await pictureReady(page);
			await page.screenshot({ path: file('keep-line', info, scheme) });
			await page.setViewportSize({ width: 820, height: 1180 });
			await expect(page.getByTestId('keep-line')).toBeVisible();
			await pictureReady(page);
			await page.screenshot({ path: file('keep-line', info, scheme, 'tablet') });
		});

		test('the read-only notice of a second page', async ({ page, context }, info) => {
			await open(page, 'text');
			await keepCopy(page);
			const second = await context.newPage();
			await second.emulateMedia({ colorScheme: scheme });
			await second.goto(`/app?mode=${isTouch(info) ? 'visual' : 'text'}`);
			await expect(second.getByTestId('plan-notice')).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await expect(second.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
				timeout: READY_TIMEOUT_MS,
			});
			await pictureReady(second);
			await second.screenshot({ path: file('read-only', info, scheme) });
		});

		test('the notice that the browser cleared its plans', async ({ page }, info) => {
			test.skip(!isTouch(info), 'the phones: their notice is the only place it shows');
			await open(page, 'text');
			await keepCopy(page);
			await page.evaluate(
				() =>
					new Promise<void>((resolve) => {
						const r = indexedDB.deleteDatabase('mainspring');
						r.onsuccess = r.onerror = () => resolve();
					}),
			);
			await open(page, 'visual');
			await expect(page.getByTestId('plan-notice')).toBeVisible();
			await pictureReady(page);
			await page.screenshot({ path: file('cleared', info, scheme) });
		});
	});
}

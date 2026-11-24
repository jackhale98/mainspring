// SPDX-License-Identifier: GPL-2.0-or-later
// Pictures of the sync status control and its panel (SCREENSHOTS=1; phase-4.md 11.1, T14), light and
// dark, on a desktop (1440 px: the label shows), a tablet (820 x 1180 on the desktop project: the icon
// alone), the Pixel 7 and the iPhone 14: each state a plan can be in today with its panel open (a
// sample, kept in this browser, changes this browser refused, read-only), and on the desktop the dev
// page with every state of the union, the ones T7 will reach included:
// docs/phases/screenshots/phase-4/t14-<what>-<device>-<scheme>.png. Without SCREENSHOTS=1 the tests
// are skipped (each boots the engine).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { deviceName, isTouch } from './lib/gantt-rig';
import { modKey } from './lib/keys';
import { pictureReady } from './lib/settle';
import { READY_TIMEOUT_MS, editor } from './lib/text-mode';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-4');
test.setTimeout(READY_TIMEOUT_MS * 2 + 60_000);
test.skip(!process.env['SCREENSHOTS'], 'pictures only on request');

const file = (what: string, info: TestInfo, scheme: string, device = deviceName(info)): string =>
	path.join(DIR, `t14-${what}-${device}-${scheme}.png`);
const control = (page: Page) => page.getByTestId('sync-status');

async function open(page: Page): Promise<void> {
	await page.goto('/app?sample=ui-basic&mode=visual');
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
}

async function change(page: Page, line: string): Promise<void> {
	// The Text tab holds the editor on a phone; the Visual view has none on a desktop.
	const tab = page.getByRole('tab', { name: 'Text', exact: true });
	if (await tab.isVisible()) await tab.click();
	else await page.getByRole('button', { name: 'Text', exact: true }).click();
	await editor(page).click();
	await page.keyboard.press(`${await modKey(page)}+Home`);
	await page.keyboard.insertText(line);
	// Back to the chart, which is what a person looks at.
	if (await tab.isVisible()) await page.getByRole('tab', { name: 'Gantt', exact: true }).click();
	else await page.getByRole('button', { name: 'Visual', exact: true }).click();
}

/** The picture of the open panel, at each size of the project (the desktop project also does a tablet). */
async function shoot(page: Page, what: string, info: TestInfo, scheme: string): Promise<void> {
	await control(page).click();
	await expect(page.getByTestId('sync-panel')).toBeVisible();
	await pictureReady(page);
	await page.screenshot({ path: file(what, info, scheme) });
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('sync-panel')).toBeHidden();
	if (info.project.name !== 'desktop') return;
	await page.setViewportSize({ width: 820, height: 1180 });
	await control(page).click();
	await expect(page.getByTestId('sync-panel')).toBeVisible();
	await pictureReady(page);
	await page.screenshot({ path: file(what, info, scheme, 'tablet') });
	await page.keyboard.press('Escape');
	await page.setViewportSize({ width: 1440, height: 900 });
}

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`the sync status control (${scheme})`, () => {
		test.beforeEach(async ({ page }, info) => {
			fs.mkdirSync(DIR, { recursive: true });
			await page.emulateMedia({ colorScheme: scheme });
			if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
		});

		test('a sample, then kept in this browser', async ({ page }, info) => {
			await open(page);
			await shoot(page, 'sample', info, scheme);
			await change(page, '# kept\n');
			await expect(control(page)).toHaveAttribute('data-kind', 'browser-only', {
				timeout: 10_000,
			});
			await shoot(page, 'browser-only', info, scheme);
		});

		test('changes this browser refused', async ({ page }, info) => {
			await page.addInitScript(() => {
				IDBFactory.prototype.open = function (): IDBOpenDBRequest {
					throw new DOMException('blocked', 'SecurityError');
				};
			});
			await open(page);
			await change(page, '# not kept\n');
			await expect(control(page)).toHaveAttribute('data-kind', 'failed', { timeout: 10_000 });
			await shoot(page, 'not-kept', info, scheme);
		});

		test('read-only in a second page', async ({ page, context }, info) => {
			await open(page);
			await change(page, '# kept\n');
			await expect(control(page)).toHaveAttribute('data-kind', 'browser-only', {
				timeout: 10_000,
			});
			const second = await context.newPage();
			await second.emulateMedia({ colorScheme: scheme });
			if (info.project.name === 'desktop')
				await second.setViewportSize({ width: 1440, height: 900 });
			await second.goto('/app?mode=visual');
			await expect(control(second)).toHaveAttribute('data-kind', 'read-only', {
				timeout: READY_TIMEOUT_MS,
			});
			await expect(second.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
				timeout: READY_TIMEOUT_MS,
			});
			await shoot(second, 'read-only', info, scheme);
		});

		test('every state, on the dev page', async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop', 'the gallery is one picture, at 1440 px');
			// Reduced motion: the working mark holds still, drawn, instead of mid-stroke.
			await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
			await page.setViewportSize({ width: 1700, height: 1200 });
			await page.goto('/dev/sync-status?wide=1');
			await expect(page.getByTestId('sync-demo')).toBeVisible();
			await pictureReady(page);
			await page.screenshot({ path: file('all-states', info, scheme), fullPage: true });
			await page.setViewportSize({ width: 412, height: 1000 });
			await page.goto('/dev/sync-status?phone=1');
			await expect(page.getByTestId('sync-demo')).toBeVisible();
			await pictureReady(page);
			await page.screenshot({
				path: file('all-states', info, scheme, 'phone-width'),
				fullPage: true,
			});
		});
	});
}

// The phone's top bar is the one place the control is squeezed (a sixth 44 px control): its picture
// with a long plan name, closed, on both phones.
for (const scheme of ['light', 'dark'] as const) {
	test(`the phone top bar with the control (${scheme})`, async ({ page }, info) => {
		test.skip(!isTouch(info), 'phones only');
		fs.mkdirSync(DIR, { recursive: true });
		await page.emulateMedia({ colorScheme: scheme });
		await open(page);
		await pictureReady(page);
		await page.screenshot({
			path: file('top-bar', info, scheme),
			clip: { x: 0, y: 0, width: page.viewportSize()?.width ?? 390, height: 120 },
		});
	});
}

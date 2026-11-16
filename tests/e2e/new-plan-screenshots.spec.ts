// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots of "New plan…" (phase-3.md T4), light and dark, on the desktop (1440 x 860, device
// scale factor 2) and the Pixel 7 emulation: the plan chooser with "New plan…" and the Samples
// group, the New plan sheet, and the empty state right after Create (also the phone's Plan tab); and the sheet on a 360 x 780 phone
// (light). The chooser is a native <select>, whose popup a screenshot does not capture: for the
// picture it is shown as a list box (`size`) under the chip, with the same options. Run with
// SCREENSHOTS=1; it writes docs/phases/screenshots/phase-3/new-plan-<what>-<device>-<light|dark>.png.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

test.describe('new plan screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14');
	});

	const chooser = (page: Page) => page.getByLabel('Sample plan');
	const sheet = (page: Page) => page.getByRole('dialog', { name: 'New plan' });

	async function shoot(page: Page, device: string, what: string): Promise<void> {
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(DIR, `new-plan-${what}-${device}-${scheme}.png`) });
		}
		await page.emulateMedia({ colorScheme: 'light' });
		await page.waitForTimeout(200);
	}

	async function open(page: Page): Promise<void> {
		await page.goto('/app?sample=poc-sample&mode=visual&hooks=edits,gantt');
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
	}

	/** The chooser's list, drawn open under its chip (the native popup is not in a screenshot). */
	async function showList(page: Page): Promise<void> {
		await chooser(page).evaluate((select: HTMLSelectElement) => {
			const box = select.closest('label')?.getBoundingClientRect();
			select.size = 10;
			Object.assign(select.style, {
				position: 'fixed',
				inset: 'auto',
				left: `${Math.min(box?.left ?? 0, window.innerWidth - 300)}px`,
				top: `${(box?.bottom ?? 0) + 6}px`,
				width: '19rem',
				height: 'auto',
				opacity: '1',
				zIndex: '100',
				border: '1px solid var(--color-border-strong)',
				borderRadius: '10px',
				background: 'var(--color-surface)',
				color: 'var(--color-text)',
				fontSize: '15px',
				padding: '4px',
				boxShadow: 'var(--shadow-raised)',
			});
			select.selectedIndex = 1;
		});
	}

	async function run(page: Page, device: string, touch: boolean): Promise<void> {
		await open(page);
		await showList(page);
		await shoot(page, device, 'chooser');
		await page.reload();
		await open(page);

		await chooser(page).selectOption({ label: 'New plan…' });
		await expect(sheet(page)).toBeVisible();
		await page.waitForTimeout(500);
		await sheet(page).getByLabel('Name', { exact: true }).fill('Website relaunch');
		await sheet(page).getByLabel('Start').fill('2026-11-16');
		await sheet(page).getByLabel('Time zone').selectOption({ label: 'Europe/Berlin' });
		await shoot(page, device, 'sheet');

		const create = sheet(page).getByRole('button', { name: 'Create' });
		if (touch) await create.tap();
		else await create.click();
		await expect(sheet(page)).toBeHidden();
		await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('No tasks yet', {
			timeout: READY_TIMEOUT_MS,
		});
		await page.waitForTimeout(1000);
		await shoot(page, device, 'empty-state');
		if (touch) {
			// The phone's Plan tab shows the same empty state.
			await page.getByRole('tab', { name: 'Plan', exact: true }).tap();
			await expect(page.locator('#panel-plan').getByTestId('empty-state')).toBeVisible();
			await page.waitForTimeout(500);
			await page.screenshot({ path: path.join(DIR, 'new-plan-empty-plan-tab-pixel-7-light.png') });
		}
	}

	test.describe('desktop', () => {
		test.use({ deviceScaleFactor: 2 });
		test('chooser, sheet, empty state', async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await page.setViewportSize({ width: 1440, height: 860 });
			await run(page, 'desktop', false);
		});
	});

	test.describe('pixel 7', () => {
		test('chooser, sheet, empty state', async ({ page }, info) => {
			test.skip(info.project.name !== 'pixel-7');
			await run(page, 'pixel-7', isTouch(info));
		});

		test.describe('360 x 780', () => {
			test.use({ deviceScaleFactor: 2 });
			test('sheet', async ({ page }, info) => {
				test.skip(info.project.name !== 'pixel-7');
				await page.setViewportSize({ width: 360, height: 780 });
				await open(page);
				await chooser(page).selectOption({ label: 'New plan…' });
				await expect(sheet(page)).toBeVisible();
				await page.waitForTimeout(500);
				await sheet(page).getByLabel('Name', { exact: true }).fill('Website relaunch');
				await sheet(page).getByLabel('Start').fill('2026-11-16');
				await sheet(page).getByLabel('Time zone').selectOption({ label: 'Europe/Berlin' });
				await page.screenshot({ path: path.join(DIR, 'new-plan-sheet-phone-360-light.png') });
			});
		});
	});
});

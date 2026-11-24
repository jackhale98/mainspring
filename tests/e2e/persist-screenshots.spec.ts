// SPDX-License-Identifier: GPL-2.0-or-later
// Pictures of the plans kept in the browser (SCREENSHOTS=1; phase-4.md 7.1, 9.4, T4), light and
// dark: the footer's line once a sample's copy is kept (desktop and a tablet-sized desktop), the
// read-only notice of a second page with "Open here instead" (desktop, Pixel 7, iPhone 14), and the
// notice that the browser cleared its plans (the phones, where no footer line is), the chooser with
// the plans kept here ("Your plans", drawn as a list box: a native picker is not in a screenshot),
// the notice that the last plan could not be opened (T4 review H2), and the notice that changes
// were not kept because another page took the plan first (desktop, Pixel 7, iPhone 14; T4
// re-check N1):
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

		test('the notice that changes were not kept', async ({ page, context }, info) => {
			// Without Web Locks or BroadcastChannel both pages edit; the store refuses the first.
			await context.addInitScript(() => {
				Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
				Reflect.deleteProperty(window, 'BroadcastChannel');
			});
			await open(page, 'text');
			await keepCopy(page);
			const second = await context.newPage();
			await second.goto('/app?mode=text');
			await expect(second.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
				timeout: READY_TIMEOUT_MS,
			});
			await second.close();
			await editor(page).click();
			await page.keyboard.press(`${await modKey(page)}+Home`);
			await page.keyboard.insertText('# not kept\n');
			await expect(page.getByTestId('plan-notice')).toHaveAttribute('data-kind', 'refused', {
				timeout: 10_000,
			});
			await editor(page).blur();
			await pictureReady(page);
			await page.screenshot({ path: file('refused', info, scheme) });
		});

		test('the chooser with the plans kept here', async ({ page }, info) => {
			await open(page, 'text');
			await keepCopy(page);
			await page
				.getByLabel(strings.topBar.sample)
				.selectOption({ label: strings.samples['ui-people'] });
			await expect(page.getByLabel(strings.topBar.sample).locator('optgroup')).toHaveCount(2);
			await page.getByLabel(strings.topBar.sample).evaluate((select: HTMLSelectElement) => {
				const box = select.closest('label')?.getBoundingClientRect();
				select.size = 12;
				Object.assign(select.style, {
					position: 'fixed',
					inset: 'auto',
					left: `${Math.max(8, Math.min(box?.left ?? 0, window.innerWidth - 312))}px`,
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
			});
			await pictureReady(page);
			await page.screenshot({ path: file('chooser', info, scheme) });
		});

		test('the notice that the last plan could not be opened', async ({ page }, info) => {
			// Storage that refuses to open (as persist.spec.ts does it; a cache may still serve a
			// blocked chunk).
			await page.addInitScript(() => {
				const blocked = sessionStorage.getItem('block-idb') === '1';
				// On the prototype, as persist.spec.ts does (a property on `indexedDB` can be lost).
				const open = IDBFactory.prototype.open;
				IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
					if (blocked) throw new DOMException('blocked', 'SecurityError');
					return open.call(this, name, version);
				};
			});
			await open(page, 'text');
			await keepCopy(page);
			await page.evaluate(() => sessionStorage.setItem('block-idb', '1'));
			await page.goto('/app?mode=visual');
			await expect(page.getByTestId('plan-notice')).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
				timeout: READY_TIMEOUT_MS,
			});
			await pictureReady(page);
			await page.screenshot({ path: file('unopened', info, scheme) });
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

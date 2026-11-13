// SPDX-License-Identifier: GPL-2.0-or-later
// Phase-2 screenshots of the read-only Gantt (phase-2.md 13.2, CLAUDE.md "Mobile counts"),
// written only when SCREENSHOTS=1 so that normal runs leave the repository alone. Desktop and
// tablet through viewport sizes at device scale factor 2, the phone through Pixel 7 emulation;
// each in light and dark.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');
const TUTORIAL = 'upstream-tutorial';

test.describe('gantt screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to refresh docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	async function open(page: Page, sample: string, mode?: string): Promise<void> {
		await page.goto(`/app?sample=${sample}${mode ? `&mode=${mode}` : ''}`);
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByTestId('gantt')).toBeVisible();
		// Bars appear with the first result; let the fonts and the first paint settle.
		await expect(page.getByRole('treeitem').first()).toBeVisible();
		await page.waitForTimeout(700);
	}

	const shot = (page: Page, name: string) => page.screenshot({ path: path.join(DIR, name) });

	for (const scheme of ['light', 'dark'] as const) {
		test.describe(`desktop ${scheme}`, () => {
			test.use({ deviceScaleFactor: 2 });

			test(`gantt-desktop-split-${scheme}.png`, async ({ page }, info) => {
				test.skip(info.project.name !== 'desktop');
				await page.setViewportSize({ width: 1440, height: 860 });
				await page.emulateMedia({ colorScheme: scheme });
				await open(page, TUTORIAL);
				await page
					.getByRole('treeitem', { name: /Project/ })
					.first()
					.click();
				await page.waitForTimeout(300);
				await shot(page, `gantt-desktop-split-${scheme}.png`);
			});

			test(`gantt-desktop-gantt-${scheme}.png and the zoom levels`, async ({ page }, info) => {
				test.skip(info.project.name !== 'desktop');
				await page.setViewportSize({ width: 1440, height: 860 });
				await page.emulateMedia({ colorScheme: scheme });
				await open(page, 'upstream-fedora-20', 'visual');
				await shot(page, `gantt-desktop-gantt-${scheme}.png`);
				if (scheme !== 'light') return;
				const gantt = page.getByTestId('gantt');
				const zoom = page.getByRole('combobox', { name: 'Zoom' });
				for (const level of ['day', 'month', 'quarter']) {
					await zoom.selectOption(level);
					await expect(gantt).toHaveAttribute('data-zoom', level);
					await page.waitForTimeout(300);
					await shot(page, `gantt-zoom-${level}.png`);
				}
			});
		});

		test(`gantt-tablet-${scheme}.png`, async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await page.setViewportSize({ width: 820, height: 1180 });
			await page.emulateMedia({ colorScheme: scheme });
			await open(page, TUTORIAL);
			await shot(page, `gantt-tablet-${scheme}.png`);
			await page.getByRole('button', { name: 'Split' }).click();
			await page.waitForTimeout(400);
			await shot(page, `gantt-tablet-split-${scheme}.png`);
		});

		// The critical path, float tails and the estimate on the selected task's line (T5).
		test(`gantt-critical-desktop-${scheme}.png`, async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await page.setViewportSize({ width: 1440, height: 860 });
			await page.emulateMedia({ colorScheme: scheme });
			await open(page, TUTORIAL, 'visual');
			await page
				.getByRole('treeitem')
				.filter({ hasText: 'Graphical User Interface' })
				.first()
				.click();
			await expect(page.getByRole('status').filter({ hasText: '(estimate)' })).toBeVisible();
			await page.waitForTimeout(300);
			await shot(page, `gantt-critical-desktop-${scheme}.png`);
		});

		test(`gantt-critical-pixel7-${scheme}.png`, async ({ page }, info) => {
			test.skip(info.project.name !== 'pixel-7');
			await page.emulateMedia({ colorScheme: scheme });
			await open(page, TUTORIAL);
			await page
				.getByRole('treeitem')
				.filter({ hasText: 'Graphical User Interface' })
				.first()
				.click();
			await expect(page.getByRole('status').filter({ hasText: '(estimate)' })).toBeVisible();
			// The phone shows a few weeks: scroll to the critical stretch (March 2002).
			await page.getByTestId('gantt').evaluate((g) => {
				const scroller = g.querySelector('.scroller');
				if (scroller) scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) * 0.55;
			});
			await page.waitForTimeout(400);
			await shot(page, `gantt-critical-pixel7-${scheme}.png`);
		});

		test(`gantt-pixel7-${scheme}.png`, async ({ page }, info) => {
			test.skip(info.project.name !== 'pixel-7');
			await page.emulateMedia({ colorScheme: scheme });
			await open(page, TUTORIAL);
			await shot(page, `gantt-pixel7-${scheme}.png`);
			await page.getByRole('treeitem').nth(2).click();
			await page.waitForTimeout(300);
			await shot(page, `gantt-pixel7-selected-${scheme}.png`);
		});
	}
});

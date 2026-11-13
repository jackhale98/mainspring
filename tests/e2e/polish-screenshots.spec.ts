// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots and measurements for the Phase 2 polish list (docs/phases/phase-2-polish.md),
// written only when SCREENSHOTS=1: polish-<item>-<what>-<device>-<scheme>[-before].png in
// docs/phases/screenshots/phase-2/. SHOT_TAG=before marks the pictures taken on the build before the
// fix. Desktop is 1440 x 860 at device scale 2, the phone is Pixel 7 emulation.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');
const TAG = process.env['SHOT_TAG'] ? `-${process.env['SHOT_TAG']}` : '';
const TUTORIAL = 'upstream-tutorial';
const FEDORA = 'upstream-fedora-20';

/** Machado et al. 2009 simulations at full severity (linear RGB, as SVG filters work by default). */
const CVD = {
	protanopia:
		'0.152286 1.052583 -0.204868 0 0  0.114503 0.786281 0.099216 0 0  -0.003882 -0.048116 1.051998 0 0  0 0 0 1 0',
	deuteranopia:
		'0.367322 0.860646 -0.227968 0 0  0.280085 0.672501 0.047413 0 0  -0.011820 0.042940 0.968881 0 0  0 0 0 1 0',
} as const;

test.describe('polish screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS + 90_000);
	test.use({ deviceScaleFactor: 2 });

	async function open(page: Page, sample: string, device: string): Promise<void> {
		if (device === 'desktop') await page.setViewportSize({ width: 1440, height: 860 });
		await page.goto(`/app?sample=${sample}${device === 'desktop' ? '&mode=visual' : ''}`);
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByTestId('gantt')).toBeVisible();
		await expect(page.locator('[role="row"][data-key]').first()).toBeVisible();
		await page.waitForTimeout(800);
	}

	const shot = async (target: Page | Locator, name: string): Promise<void> => {
		await target.screenshot({ path: path.join(DIR, `${name}${TAG}.png`) });
	};
	const scroll = (page: Page, x: number | null, y: number | null): Promise<void> =>
		page.getByTestId('gantt').evaluate(
			(g, [sx, sy]) => {
				const s = g.querySelector('.scroller');
				if (!s) return;
				if (sx !== null) s.scrollLeft = sx;
				if (sy !== null) s.scrollTop = sy;
			},
			[x, y] as const,
		);

	for (const scheme of ['light', 'dark'] as const) {
		for (const device of ['desktop', 'pixel7'] as const) {
			const mine = (info: { project: { name: string } }): boolean =>
				info.project.name === (device === 'desktop' ? 'desktop' : 'pixel-7');

			// 1: where a link drops to a task that starts at, or just right of, the line.
			for (const [sample, label] of [
				['gantt-500', 'gantt500'],
				[TUTORIAL, 'tutorial'],
				[FEDORA, 'fedora'],
			] as const) {
				if (device === 'pixel7' && label === 'fedora') continue;
				test(`1 arrows ${label} ${device} ${scheme}`, async ({ page }, info) => {
					test.skip(!mine(info));
					await page.emulateMedia({ colorScheme: scheme });
					await open(page, sample, device);
					await shot(page.getByTestId('gantt'), `polish-1-arrows-${label}-${device}-${scheme}`);
				});
			}

			// 2 and 3: the today line against labels, short bars with their name beside them.
			test(`2 3 marker lines and short labels ${device} ${scheme}`, async ({ page }, info) => {
				test.skip(!mine(info));
				await page.emulateMedia({ colorScheme: scheme });
				await open(page, 'gantt-500', device);
				// Items 9 and 10 (rows 11 and 12) start on Feb 26 and 27, 2026, by the status date line.
				await scroll(page, device === 'desktop' ? 650 : 790, 400);
				await page.waitForTimeout(500);
				await shot(page.getByTestId('gantt'), `polish-2-marker-labels-${device}-${scheme}`);
			});

			// 4: the month name pushed out by the next month, under the task column.
			test(`4 month sliver ${device} ${scheme}`, async ({ page }, info) => {
				test.skip(!mine(info));
				await page.emulateMedia({ colorScheme: scheme });
				await open(page, FEDORA, device);
				const head = page.getByTestId('gantt-header');
				for (const [i, left] of [0, 14, 40, 70].entries()) {
					await scroll(page, left, 0);
					await page.waitForTimeout(250);
					const names = await page.getByTestId('gantt').locator('.names').boundingBox();
					const band = await head.boundingBox();
					if (!names || !band) continue;
					await page.screenshot({
						path: path.join(DIR, `polish-4-month-sliver-${device}-${scheme}-${i}${TAG}.png`),
						clip: { x: names.x + names.width - 60, y: band.y, width: 300, height: band.height },
					});
				}
			});

			// 5: the critical bar's edge.
			test(`5 critical edge ${device} ${scheme}`, async ({ page }, info) => {
				test.skip(!mine(info));
				await page.emulateMedia({ colorScheme: scheme });
				await open(page, TUTORIAL, device);
				// The critical stretch of the tutorial (Graphical User Interface, the tests): scroll to it.
				await page.getByTestId('gantt').evaluate((g) => {
					const s = g.querySelector('.scroller');
					if (s) s.scrollLeft = (s.scrollWidth - s.clientWidth) * 0.55;
				});
				await page.waitForTimeout(500);
				await shot(page.getByTestId('gantt'), `polish-5-critical-edge-${device}-${scheme}`);
				for (const [kind, matrix] of Object.entries(CVD)) {
					await page.evaluate(
						([k, m]) => {
							document.getElementById('cvd')?.remove();
							const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
							svg.id = 'cvd';
							svg.setAttribute('width', '0');
							svg.setAttribute('height', '0');
							svg.style.position = 'absolute';
							svg.innerHTML = `<filter id="${k}"><feColorMatrix type="matrix" values="${m}"/></filter>`;
							document.body.append(svg);
							document.documentElement.style.filter = `url(#${k})`;
						},
						[kind, matrix] as const,
					);
					await page.waitForTimeout(300);
					await shot(
						page.getByTestId('gantt'),
						`polish-5-critical-edge-${kind}-${device}-${scheme}`,
					);
				}
			});
		}

		// 6: the Plan tab unmounts while hidden; its scroll and collapse survive a round trip.
		test(`6 plan tab pixel7 ${scheme}`, async ({ page }, info) => {
			test.skip(info.project.name !== 'pixel-7');
			await page.emulateMedia({ colorScheme: scheme });
			await open(page, 'gantt-500', 'pixel7');
			const count = (): Promise<number> =>
				page.evaluate(() => document.querySelectorAll('*').length);
			const gantt = await count();
			await page.getByRole('tab', { name: 'Plan' }).click();
			await page.waitForTimeout(500);
			const plan = await count();
			const tasks = page.getByRole('tree', { name: 'Tasks' }).locator('xpath=..');
			await tasks.evaluate((el) => (el.scrollTop = 900));
			await page.waitForTimeout(300);
			await page.getByRole('tab', { name: 'Gantt' }).click();
			await page.waitForTimeout(500);
			const back = await count();
			await page.getByRole('tab', { name: 'Plan' }).click();
			await page.waitForTimeout(500);
			const top = await tasks.evaluate((el) => el.scrollTop);
			await shot(page, `polish-6-plan-tab-pixel7-${scheme}`);
			fs.writeFileSync(
				path.join(DIR, `polish-6-node-counts-${scheme}${TAG}.json`),
				JSON.stringify(
					{
						sample: 'gantt-500',
						ganttTabNodes: gantt,
						planTabNodes: plan,
						ganttAgainNodes: back,
						planScrollTopAfterRoundTrip: top,
					},
					null,
					2,
				),
			);
		});

		// 9: the pill that explains an empty critical path, over the scroller's last row.
		test(`9 phone pill pixel7 ${scheme}`, async ({ page }, info) => {
			test.skip(info.project.name !== 'pixel-7');
			await page.emulateMedia({ colorScheme: scheme });
			await open(page, FEDORA, 'pixel7');
			await expect(page.getByRole('button', { name: 'Critical path' })).toHaveAttribute(
				'aria-pressed',
				'true',
			);
			await scroll(page, null, 1e7);
			await page.waitForTimeout(500);
			await shot(page, `polish-9-phone-pill-pixel7-${scheme}`);
		});
	}
});

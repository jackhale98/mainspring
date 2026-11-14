// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots of the dependency links (phase-2-polish.md item 1, revisited 2026-11-14), written
// only when SCREENSHOTS=1: links-<sample>-<device>-<scheme>[-<view>][-before].png in
// docs/phases/screenshots/phase-2/. SHOT_TAG=before marks the pictures taken on the build before
// the rework. Desktop is 1440 x 860 at device scale 2, the phone is Pixel 7 emulation.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');
const TAG = process.env['SHOT_TAG'] ? `-${process.env['SHOT_TAG']}` : '';

/** The samples, and where each is scrolled to for its second picture (a fraction of the width). */
const SAMPLES = [
	['upstream-tutorial', 'upstream-tutorial', 0.35],
	['gantt-manipulation', 'gantt-manipulation', 0.1],
	['upstream-fedora-20', 'upstream-fedora-20', 0.4],
	['gantt-500', 'gantt-500', 0.25],
] as const;

test.describe('link screenshots', () => {
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

	for (const scheme of ['light', 'dark'] as const) {
		for (const device of ['desktop', 'pixel7'] as const) {
			for (const [sample, label, fraction] of SAMPLES) {
				test(`links ${label} ${device} ${scheme}`, async ({ page }, info) => {
					test.skip(info.project.name !== (device === 'desktop' ? 'desktop' : 'pixel-7'));
					await page.emulateMedia({ colorScheme: scheme });
					await open(page, sample, device);
					const gantt = page.getByTestId('gantt');
					const name = `links-${label}-${device}-${scheme}`;
					await gantt.screenshot({ path: path.join(DIR, `${name}${TAG}.png`) });
					await gantt.evaluate((g, f) => {
						const s = g.querySelector('.scroller');
						if (s) s.scrollLeft = (s.scrollWidth - s.clientWidth) * f;
					}, fraction);
					await page.waitForTimeout(600);
					await gantt.screenshot({ path: path.join(DIR, `${name}-scrolled${TAG}.png`) });
				});
			}
		}
	}
});

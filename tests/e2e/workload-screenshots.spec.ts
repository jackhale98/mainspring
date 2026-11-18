// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots of the workload heatmap (phase-3.md T14), on `fedora-res`: the desktop heatmap at week
// zoom with the thresholds panel, over cells and the cell details, light and dark; the Pixel 7
// Load segment (light and dark, with the details sheet) and a 360 px phone (light). Run with
// SCREENSHOTS=1; it writes docs/phases/screenshots/phase-3/t14-<what>-<device>-<light|dark>.png.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, deviceName, isTouch } from './lib/gantt-rig';
import { openHeatmap, oracle, resultOf, shape } from './lib/workload-rig';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

type Win = {
	__mainspringWorkload: {
		scrollTo(p: string, c: number): boolean;
		cell(p: string, c: number): { x: number; y: number } | null;
	};
};

test.describe('workload screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS * 3);

	async function shoot(page: Page, device: string, what: string, only?: 'light'): Promise<void> {
		for (const scheme of only ? (['light'] as const) : (['light', 'dark'] as const)) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.waitForTimeout(500);
			await page.screenshot({ path: path.join(DIR, `t14-${what}-${device}-${scheme}.png`) });
		}
		await page.emulateMedia({ colorScheme: 'light' });
		await page.waitForTimeout(200);
	}

	/** A person with booked time, a column a few weeks in, and the cell's place on the screen. */
	async function busy(page: Page) {
		const result = await resultOf(page);
		if (!result) throw new Error('no result');
		const o = oracle(result);
		const s = await shape(page);
		for (const person of s?.rows ?? []) {
			if (result.resources.find((r) => r.id === person)?.group) continue;
			const col = (o.booked.get(person) ?? []).findIndex((m) => m >= 32 * 60);
			if (col >= 0) return { person, col };
		}
		throw new Error('nobody is busy');
	}

	async function pointOf(page: Page, person: string, col: number) {
		await page.evaluate(
			([p, c]) =>
				(window as unknown as Win).__mainspringWorkload.scrollTo(p as string, c as number),
			[person, col] as const,
		);
		await page.waitForTimeout(250);
		const at = await page.evaluate(
			([p, c]) => (window as unknown as Win).__mainspringWorkload.cell(p as string, c as number),
			[person, col] as const,
		);
		if (!at) throw new Error('no cell');
		return at;
	}

	test('the heatmap, the over cells and the details', async ({ page }, info) => {
		const device = deviceName(info);
		await openHeatmap(page, info);
		await page.evaluate(() =>
			(window as unknown as Win).__mainspringWorkload.scrollTo('desk01', 0),
		);
		await page.waitForTimeout(400);
		await shoot(page, device, 'heatmap-week');
		if (isTouch(info)) {
			const { person, col } = await busy(page);
			const at = await pointOf(page, person, col);
			await page.touchscreen.tap(at.x, at.y);
			await page.touchscreen.tap(at.x, at.y);
			await expect(page.getByTestId('cell-details')).toBeVisible();
			await shoot(page, device, 'details');
			await page.getByRole('button', { name: 'Close' }).tap();
			return;
		}
		// The cell details of a busy cell.
		const { person, col } = await busy(page);
		const at = await pointOf(page, person, col);
		await page.mouse.click(at.x, at.y);
		await expect(page.getByTestId('cell-details')).toBeVisible();
		await shoot(page, device, 'details');
		await page.getByRole('button', { name: 'Close' }).click();
		// Thresholds at 90 %: the full weeks turn over (hatched, with the corner mark).
		await page.getByTestId('heat-thresholds-chip').click();
		await shoot(page, device, 'thresholds');
		await page.getByLabel('Over above', { exact: true }).fill('90');
		await page.getByLabel('Over above', { exact: true }).press('Enter');
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);
		await shoot(page, device, 'over');
		await page.getByRole('radiogroup', { name: 'Unit' }).getByRole('radio', { name: '%' }).click();
		await shoot(page, device, 'percent');
	});

	test('a 360 px phone', async ({ page }, info) => {
		test.skip(info.project.name !== 'pixel-7');
		await page.setViewportSize({ width: 360, height: 740 });
		await openHeatmap(page, info);
		await page.waitForTimeout(500);
		await shoot(page, '360', 'heatmap-week', 'light');
	});
});

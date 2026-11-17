// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots of the Gantt filter (phase-3.md T19), light and dark, at device scale factor 2, on the
// Fedora plan with a people pool. Desktop (1280 x 720): the panel open with a person and a flag
// chosen, the chart filtered by a person (context rows muted), by a flag, and an empty result.
// Pixel 7: the sheet, and the filtered chart. Run with SCREENSHOTS=1; it writes
// docs/phases/screenshots/phase-3/t19-<what>-<device>-<light|dark>.png.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ScheduleResult } from '../../src/engine/protocol';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

test.describe('gantt filter screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.use({ deviceScaleFactor: 2, actionTimeout: 15_000 });

	async function shoot(page: Page, device: string, what: string): Promise<void> {
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(DIR, `t19-${what}-${device}-${scheme}.png`) });
		}
		await page.emulateMedia({ colorScheme: 'light' });
		await page.waitForTimeout(200);
	}

	/** A person with a few tasks, from the result's `allocated` lists. */
	async function aPerson(page: Page): Promise<{ id: string; name: string }> {
		const r = await page.evaluate(() =>
			(
				window as unknown as { __mainspringGantt: { result(): ScheduleResult | null } }
			).__mainspringGantt.result(),
		);
		if (!r?.project) throw new Error('no result');
		const sc = r.project.scenarios.find((s) => s.active)?.id ?? '';
		for (const p of r.resources.filter((x) => !x.group)) {
			const n = r.tasks.filter((t) => t.scenarios[sc]?.allocated.includes(p.id)).length;
			if (n >= 4 && n <= 14) return { id: p.id, name: p.name };
		}
		throw new Error('no person');
	}

	test('desktop', async ({ page }, info) => {
		test.skip(isTouch(info));
		await page.setViewportSize({ width: 1280, height: 720 });
		await Rig.open(page, info, 'month', 'visual', 'fedora-res');
		const person = await aPerson(page);
		const panel = page.getByTestId('filter-panel');
		await page.getByTestId('filter-button').click();
		await page.getByRole('combobox', { name: 'Find a person to filter by' }).fill(person.name);
		await panel.locator(`[role="option"][data-person="${person.id}"]`).click();
		await page.getByRole('combobox', { name: 'Find a person to filter by' }).fill('');
		await page.mouse.move(640, 700);
		await shoot(page, 'desktop', 'panel-person');
		await panel.getByRole('radio', { name: /^key\b/ }).check();
		await page.mouse.move(640, 700);
		await shoot(page, 'desktop', 'panel-person-flag');
		await panel.getByRole('radio', { name: 'Any flag' }).check();
		await panel.getByRole('button', { name: 'Done' }).click();
		await expect(panel).toBeHidden();
		await page.mouse.move(640, 700);
		await shoot(page, 'desktop', 'person');

		await page.getByTestId('filter-clear').click();
		await page.getByTestId('filter-button').click();
		await panel.getByRole('radio', { name: /^key\b/ }).check();
		await panel.getByRole('button', { name: 'Done' }).click();
		await page.mouse.move(640, 700);
		await shoot(page, 'desktop', 'flag');

		await page.getByTestId('filter-button').click();
		await page.getByRole('combobox', { name: 'Find a person to filter by' }).fill(person.name);
		await panel.locator(`[role="option"][data-person="${person.id}"]`).click();
		await panel.getByRole('radio', { name: /^ambassadors\b/ }).check();
		await panel.getByRole('button', { name: 'Done' }).click();
		await expect(page.getByTestId('filter-empty')).toBeVisible();
		await page.mouse.move(640, 700);
		await shoot(page, 'desktop', 'empty');
	});

	test('pixel 7', async ({ page }, info) => {
		test.skip(!isTouch(info));
		await Rig.open(page, info, 'week', 'visual', 'fedora-res');
		const person = await aPerson(page);
		await shoot(page, 'pixel-7', 'toolbar');
		const panel = page.getByTestId('filter-panel');
		await page.getByTestId('filter-button').click();
		await expect(panel).toBeVisible();
		await shoot(page, 'pixel-7', 'sheet');
		await panel.locator(`[role="option"][data-person="${person.id}"]`).click();
		await panel.getByRole('radio', { name: /^key\b/ }).check();
		await shoot(page, 'pixel-7', 'sheet-person-flag');
		await panel.getByRole('radio', { name: 'Any flag' }).check();
		await panel.getByRole('button', { name: 'Done' }).click();
		await expect(panel).toBeHidden();
		await shoot(page, 'pixel-7', 'person');
	});
});

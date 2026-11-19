// SPDX-License-Identifier: GPL-2.0-or-later
// Pictures of the real app where the primitives changed how it looks (SCREENSHOTS=1; ADR-0016 #3):
// the inspector's selects, the new-plan time zone, the health replace-person pill, a heat cell's move
// pills, the calendar bar's arrow, the row menu and the engine-details popover, on the phone emulations
// (Pixel 7 and iPhone 14): docs/phases/screenshots/phase-3/t25-app-<what>-<device>-<scheme>.png.
// Without SCREENSHOTS=1 the tests are skipped (each boots the engine).
import path from 'node:path';
import { expect, test, type TestInfo } from '@playwright/test';
import { REPO } from '../../golden/corpus';
import { openCalendar } from '../lib/calendar-rig';
import { READY_TIMEOUT_MS, deviceName, isTouch } from '../lib/gantt-rig';
import { openHealthPanel } from '../lib/select-states';
import { ready } from '../lib/sheet-rig';
import { openHeatmap, oracle, resultOf, shape } from '../lib/workload-rig';
import { pictureReady } from '../lib/settle';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');
test.setTimeout(READY_TIMEOUT_MS * 3);
test.skip(!process.env['SCREENSHOTS'], 'pictures only on request');

const file = (what: string, info: TestInfo, scheme: string): string =>
	path.join(DIR, `t25-app-${what}-${deviceName(info)}-${scheme}.png`);

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`the app with the primitives (${scheme})`, () => {
		test.beforeEach(async ({ page }, info) => {
			test.skip(!isTouch(info), 'the phone emulations');
			await page.emulateMedia({ colorScheme: scheme });
		});

		test('the inspector’s selects', async ({ page }, info) => {
			await page.goto('/app?sample=gantt-manipulation&mode=visual&hooks=edits');
			await ready(page);
			const row = page
				.locator('[role="treegrid"] [role="row"][data-key]')
				.filter({ has: page.locator('[data-col="name"] .label', { hasText: 'Research' }) })
				.first();
			await expect(row).toBeVisible();
			await pictureReady(page);
			await row.click();
			const panel = page.getByRole('dialog', { name: /Task details/ });
			if ((await panel.count()) === 0) await row.click();
			await expect(panel.getByLabel('Name', { exact: true })).toHaveValue('Research');
			await pictureReady(page);
			// Full height shows the selects (Size, scheduling, responsible).
			await panel.getByRole('button', { name: /Details height/ }).click();
			await pictureReady(page);
			await panel
				.getByLabel('Scheduling')
				.scrollIntoViewIfNeeded()
				.catch(() => undefined);
			await page.screenshot({ path: file('inspector-selects', info, scheme) });
		});

		test('the row menu', async ({ page }, info) => {
			await page.goto('/app?sample=gantt-manipulation&mode=visual&hooks=edits');
			await ready(page);
			const row = page
				.locator('[role="treegrid"] [role="row"][data-key]')
				.filter({ has: page.locator('[data-col="name"] .label', { hasText: 'Research' }) })
				.first();
			await expect(row).toBeVisible();
			await pictureReady(page);
			await row.click();
			await page.getByTestId('row-menu').tap();
			await expect(page.getByRole('menu')).toBeVisible();
			await pictureReady(page);
			await page.screenshot({ path: file('row-menu', info, scheme) });
		});

		test('the engine details popover', async ({ page }, info) => {
			await page.goto('/app?sample=gantt-manipulation&mode=visual');
			await ready(page);
			await page.getByTestId('status-button').tap();
			await expect(page.getByTestId('engine-info-details')).toBeVisible();
			await pictureReady(page);
			await page.screenshot({ path: file('engine-popover', info, scheme) });
		});

		test('the calendar bar’s arrow', async ({ page }, info) => {
			await openCalendar(page, info);
			await pictureReady(page);
			await page.screenshot({ path: file('calendar-bar', info, scheme) });
		});

		test('the health replace-person pill', async ({ page }, info) => {
			test.skip(scheme === 'dark', 'light is enough for the pill');
			const row = await openHealthPanel(page, info);
			await expect(row.locator('select[data-fix="replace-person"]')).toBeVisible();
			await row.scrollIntoViewIfNeeded();
			await page.screenshot({ path: file('health-pill', info, scheme) });
		});

		test('a heat cell’s move pills', async ({ page }, info) => {
			test.skip(scheme === 'dark', 'light is enough for the pills');
			await openHeatmap(page, info);
			const result = await resultOf(page);
			if (!result) throw new Error('no result');
			const o = oracle(result);
			const s = await shape(page);
			let target: { person: string; col: number } | null = null;
			for (const person of s?.rows ?? []) {
				if (result.resources.find((r) => r.id === person)?.group) continue;
				const col = (o.booked.get(person) ?? []).findIndex((m) => m > 0);
				if (col >= 0) {
					target = { person, col };
					break;
				}
			}
			if (!target) throw new Error('nobody is booked');
			type Hook = {
				scrollTo(p: string, c: number): boolean;
				cell(p: string, c: number): { x: number; y: number } | null;
			};
			const { person, col } = target;
			const hook = (): Promise<{ x: number; y: number } | null> =>
				page.evaluate(
					([p, c]) => {
						const h = (window as unknown as { __mainspringWorkload: Hook }).__mainspringWorkload;
						h.scrollTo(p as string, c as number);
						return h.cell(p as string, c as number);
					},
					[person, col] as const,
				);
			await hook();
			await pictureReady(page);
			const at = await hook();
			if (!at) throw new Error('no cell');
			await page.touchscreen.tap(at.x, at.y);
			await page.touchscreen.tap(at.x, at.y);
			await expect(page.getByTestId('cell-details')).toBeVisible();
			await pictureReady(page);
			await page.screenshot({ path: file('heat-move-pills', info, scheme) });
		});

		test('the new-plan time zone', async ({ page }, info) => {
			await page.goto('/app?sample=gantt-manipulation&mode=visual');
			await ready(page);
			await page.getByLabel('Sample plan').selectOption({ label: 'New plan…' });
			await expect(page.getByRole('dialog', { name: /New plan/ })).toBeVisible();
			await pictureReady(page);
			await page.screenshot({ path: file('new-plan-zone', info, scheme) });
		});
	});
}

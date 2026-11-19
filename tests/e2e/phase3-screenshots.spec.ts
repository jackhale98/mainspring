// SPDX-License-Identifier: GPL-2.0-or-later
// The pictures T21 adds to docs/phases/screenshots/phase-3/ (phase-3.md 13.2, last bullet: every new
// view and state, light and dark, desktop, tablet and phone). The view specs' own picture specs
// cover the desktop and the phones; what was missing is:
// - the tablet: there is no tablet project, so a tablet is the desktop project at 820 x 1180 (the
//   width the existing tablet pictures use): the heatmap, the lanes, the Resources view with a
//   person's details, the calendar with a day's details, the Health sheet, the Gantt filter, the
//   New plan sheet, the empty state and "No people";
// - the rebalance states on every device: the "Move which task?" question, the move done, and a
//   refusal.
// Run with SCREENSHOTS=1; it writes `t21-<what>-<device>-<light|dark>.png`, where a tablet's device
// is `tablet-820`. Not part of the CI run (the skip below).
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { showDay, tapDay } from './lib/calendar-rig';
import { READY_TIMEOUT_MS, Rig, deviceName } from './lib/gantt-rig';
import { dragCell, openCell, taskIn } from './lib/rebalance-rig';
import { openResources, selectRow } from './lib/resources-rig';
import { pictureReady } from './lib/settle';
import { openHeatmap } from './lib/workload-rig';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

test.describe('phase 3 pictures (T21)', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS * 3);
	test.use({ actionTimeout: 20_000 });

	async function shoot(page: Page, device: string, what: string): Promise<void> {
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await pictureReady(page);
			await page.screenshot({ path: path.join(DIR, `t21-${what}-${device}-${scheme}.png`) });
		}
		await page.emulateMedia({ colorScheme: 'light' });
		await pictureReady(page);
	}

	test.describe('tablet 820 x 1180', () => {
		const TABLET = 'tablet-820';
		test.beforeEach(async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop', 'the tablet is the desktop project at 820 px');
			await page.setViewportSize({ width: 820, height: 1180 });
		});

		test('the heatmap and a cell details', async ({ page }, info) => {
			await openHeatmap(page, info, 'ui-people');
			await shoot(page, TABLET, 'heatmap');
			await openCell(page, info, 'ana', 1);
			await shoot(page, TABLET, 'heatmap-details');
		});

		test('the Resources view and a person details', async ({ page }, info) => {
			await openResources(page, info, { plan: 'ui-people' });
			await shoot(page, TABLET, 'resources');
			// A tablet opens the details as a finger does: the first click selects, the second opens.
			await selectRow(page, info, 'ana');
			await selectRow(page, info, 'ana');
			await expect(page.getByTestId('person-details')).toBeVisible({ timeout: 30_000 });
			await shoot(page, TABLET, 'person-details');
		});

		test('the calendar and a day details', async ({ page }, info) => {
			// The switcher at this width is a menu, not radios: the address opens the view.
			await page.goto('/app?sample=ui-people&mode=visual&view=calendar&hooks=edits');
			await expect(page.getByTestId('cal-day').first()).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
				timeout: READY_TIMEOUT_MS,
			});
			await shoot(page, TABLET, 'calendar');
			// A tablet opens the details as a finger does: the first click selects, the second opens.
			const d = await showDay(page, '2026-03-24');
			await tapDay(page, info, d);
			await tapDay(page, info, d);
			await expect(page.getByTestId('cal-details')).toBeVisible();
			await shoot(page, TABLET, 'calendar-details');
		});

		test('the Health sheet', async ({ page }, info) => {
			await Rig.open(page, info, undefined, 'visual', 'ui-people');
			await page.getByTestId('health-button').click();
			const sheet = page.getByRole('dialog', { name: 'Plan health' });
			await expect(sheet).toBeVisible();
			await expect(sheet.getByTestId('health-summary')).toContainText('problem', {
				timeout: READY_TIMEOUT_MS,
			});
			await shoot(page, TABLET, 'health-sheet');
		});

		test('the Gantt filter panel', async ({ page }, info) => {
			await Rig.open(page, info, 'week', 'visual', 'ui-people');
			await page.getByTestId('filter-button').click();
			const panel = page.getByTestId('filter-panel');
			await expect(panel).toBeVisible();
			await panel.locator('[role="option"][data-person="ana"]').click();
			await shoot(page, TABLET, 'filter-panel');
		});

		test('the New plan sheet, the empty state and No people', async ({ page }, info) => {
			await Rig.open(page, info, undefined, 'visual', 'poc-sample');
			await page.getByLabel('Sample plan').selectOption({ label: 'New plan…' });
			const sheet = page.getByRole('dialog', { name: 'New plan' });
			await expect(sheet).toBeVisible();
			await sheet.getByLabel('Name', { exact: true }).fill('Tablet plan');
			await shoot(page, TABLET, 'new-plan-sheet');
			await sheet.getByRole('button', { name: 'Create' }).click();
			await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await shoot(page, TABLET, 'empty-state');
			await page.getByRole('combobox', { name: 'Views' }).selectOption({ label: 'Workload' });
			await expect(page.getByText('No people yet')).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await shoot(page, TABLET, 'no-people');
		});
	});

	test('rebalance: the question, the move done, and a refusal', async ({ page }, info) => {
		const device = deviceName(info);
		await openHeatmap(page, info, 'ui-people');
		// A cell with two movable tasks asks which one.
		await dragCell(page, info, { person: 'ana', col: 1 }, (a, _w, h) => ({ x: a.x, y: a.y + h }));
		const which = page.getByTestId('which-task');
		await expect(which).toBeVisible();
		await shoot(page, device, 'rebalance-question');
		await which.locator('button[data-task="discover.findings"]').click();
		const ask = page.getByTestId('move-question');
		if (await ask.isVisible()) await ask.locator('button.primary').click();
		await expect(page.getByTestId('heat-live')).toBeAttached();
		await expect
			.poll(async () => (await page.getByTestId('which-task').count()) === 0, {
				timeout: READY_TIMEOUT_MS,
			})
			.toBe(true);
		await shoot(page, device, 'rebalance-moved');
		await page.getByRole('button', { name: 'Undo' }).first().click();
		// A refusal: Team training is booked through the group.
		const details = await openCell(page, info, 'ben', 5);
		await taskIn(details, 'rollout.train').getByRole('combobox').first().selectOption({
			label: 'Eli',
		});
		await expect(page.getByTestId('toast').filter({ hasText: 'Booked through Team' })).toBeVisible({
			timeout: 30_000,
		});
		await shoot(page, device, 'rebalance-refused');
	});
});

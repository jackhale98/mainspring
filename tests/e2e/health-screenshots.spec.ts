// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots of plan health (phase-3.md 9.7, 13.2; CLAUDE.md "mobile counts"): desktop and Pixel 7
// emulation, light and dark, to docs/phases/screenshots/phase-3/t18-*.png, and a tablet's bottom
// sheet in light:
// - the Health tab of the right panel (the findings by check, the filters), with Notes only, with
//   the gap editor of "Edit gap" open, and the settings; the phone's status card with its "Plan
//   health" row and the full-height sheet;
// - the task details' "Why here?" for a task with a dependency and a gap, and for one the explainer
//   cannot fully explain;
// - the heatmap's cell details with a task's reasons open, and the Gantt after "Show in Gantt" with
//   the filter line naming the person.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { READY_TIMEOUT_MS, deviceName, isTouch } from './lib/gantt-rig';
import { findings, openHealth, openPlan } from './lib/health-rig';
import { openHeatmap, oracle, resultOf, shape } from './lib/workload-rig';

const DIR = path.join(process.cwd(), 'docs/phases/screenshots/phase-3');

test.beforeEach(({ browserName: _b }, info) => {
	test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T18)');
});
test.setTimeout(READY_TIMEOUT_MS * 3);

const WIKI = 'f20.PlanningPhase.clean_market_wiki';
const UNSURE = 'f20.TestingPhase.alpha.software_translation';
const LICENSE = 'f20.supplement_wallpaper.supplement_license_review';

function shooter(page: Page, info: TestInfo, scheme: string) {
	fs.mkdirSync(DIR, { recursive: true });
	return async (name: string): Promise<void> => {
		await page.waitForTimeout(500);
		await page.screenshot({
			path: path.join(DIR, `t18-${name}-${deviceName(info)}-${scheme}.png`),
		});
	};
}

for (const scheme of ['light', 'dark'] as const) {
	test(`health panel screenshots (${scheme})`, async ({ page }, info) => {
		const shot = shooter(page, info, scheme);
		await openPlan(page, info, scheme);
		if (isTouch(info)) {
			// The card first: the row that leads to the sheet.
			await expect(page.getByTestId('status-button')).toBeVisible();
			await page.getByTestId('status-button').click();
			await expect(page.getByTestId('open-health')).toHaveText('Plan health: 241', {
				timeout: READY_TIMEOUT_MS,
			});
			await shot('status-card');
			await page.keyboard.press('Escape');
		}
		const panel = await openHealth(page, info);
		await shot('health-panel');

		await panel.getByTestId('severity-info').click();
		await expect(panel.getByTestId('finding').first()).toBeVisible();
		await shot('health-notes');
		await panel.getByTestId('severity-all').click();

		// The gap editor of one finding, scrolled to the top of the panel's viewport.
		const gap = findings(panel, 'long-gap', WIKI);
		await gap.scrollIntoViewIfNeeded();
		await gap.locator('[data-fix="setDependsGap"]').click();
		await shot('health-gap-editor');
		await gap.getByRole('button', { name: 'Cancel' }).click();

		await panel.getByTestId('health-settings-button').click();
		await expect(panel.getByTestId('health-settings')).toBeVisible();
		await shot('health-settings');
	});

	test(`why here screenshots (${scheme})`, async ({ page }, info) => {
		const shot = shooter(page, info, scheme);
		const rig = await openPlan(page, info, scheme);
		for (const [name, id] of [
			['why-here', WIKI],
			['why-here-unsure', UNSURE],
		] as const) {
			if (isTouch(info) && (await page.getByRole('dialog', { name: /Task details/ }).count()) > 0) {
				await page
					.getByRole('dialog', { name: /Task details/ })
					.getByRole('button', { name: 'Close', exact: true })
					.click();
			}
			await page.evaluate(
				(t) =>
					(
						window as unknown as { __mainspringGantt: { reveal(t: string): void } }
					).__mainspringGantt.reveal(t),
				id,
			);
			const row = rig.row(`task:${id}`);
			await row.locator('[data-col="name"]').click();
			if (
				isTouch(info) &&
				(await page.getByRole('dialog', { name: /Task details/ }).count()) === 0
			) {
				await row.locator('[data-col="name"]').click();
			}
			const why = page.getByTestId('why-here');
			await expect(why.locator('li').first()).toBeVisible({ timeout: 30_000 });
			await page.getByTestId('why-section').scrollIntoViewIfNeeded();
			await shot(name);
		}
	});

	test(`cell details and Show in Gantt screenshots (${scheme})`, async ({ page }, info) => {
		const shot = shooter(page, info, scheme);
		if (scheme === 'dark') await page.emulateMedia({ colorScheme: 'dark' });
		else await page.emulateMedia({ colorScheme: 'light' });
		await openHeatmap(page, info);
		const result = await resultOf(page);
		const s = await shape(page);
		if (!result) throw new Error('no result');
		const o = oracle(result);
		let pick: { person: string; col: number; task: string } | null = null;
		for (const person of (s?.rows ?? []).slice(8)) {
			if (pick) break;
			if (result.resources.find((r) => r.id === person)?.group) continue;
			const row = o.booked.get(person) ?? [];
			for (let col = 4; col < row.length && !pick; col++) {
				if ((row[col] ?? 0) === 0) continue;
				const tasks = await page.evaluate(
					([p, c]) =>
						(
							window as unknown as {
								__mainspringWorkload: {
									tasks(p: string, c: number): Array<{ task: string; kind: string }>;
								};
							}
						).__mainspringWorkload.tasks(p as string, c as number),
					[person, col] as const,
				);
				const booked = tasks.find((t) => t.kind === 'booked');
				if (booked) pick = { person, col, task: booked.task };
			}
		}
		if (!pick) throw new Error('no booked cell');
		await page.evaluate(
			([p, c]) =>
				(
					window as unknown as { __mainspringWorkload: { scrollTo(p: string, c: number): boolean } }
				).__mainspringWorkload.scrollTo(p as string, c as number),
			[pick.person, pick.col] as const,
		);
		await page.waitForTimeout(200);
		const at = await page.evaluate(
			([p, c]) =>
				(
					window as unknown as {
						__mainspringWorkload: { cell(p: string, c: number): { x: number; y: number } | null };
					}
				).__mainspringWorkload.cell(p as string, c as number),
			[pick.person, pick.col] as const,
		);
		if (!at) throw new Error('no cell point');
		if (isTouch(info)) {
			await page.touchscreen.tap(at.x, at.y);
			await page.waitForTimeout(200);
			await page.touchscreen.tap(at.x, at.y);
		} else await page.mouse.click(at.x, at.y);
		const cell = page.getByTestId('cell-details');
		await expect(cell).toBeVisible();
		const task = cell.locator(`[data-testid="detail-task"][data-task="${pick.task}"]`);
		await task.getByTestId('why-toggle').click();
		await expect(cell.getByTestId('cell-why').locator('li').first()).toBeVisible({
			timeout: 30_000,
		});
		await task.scrollIntoViewIfNeeded();
		await shot('cell-why');

		await task.getByRole('button', { name: 'Show in Gantt' }).click();
		await expect(page.getByTestId('filter-note')).toBeVisible({ timeout: 30_000 });
		await shot('show-in-gantt');
	});
}

test('a finding about a person: Show in Gantt (desktop and phone, light)', async ({
	page,
}, info) => {
	const shot = shooter(page, info, 'light');
	await openPlan(page, info, 'light');
	const panel = await openHealth(page, info);
	const row = findings(panel, 'work-without-people', LICENSE);
	await row.scrollIntoViewIfNeeded();
	await shot('finding-person');
	await row.locator('[data-fix="show-in-gantt"]').click();
	await expect(page.getByTestId('filter-note')).toContainText('Desktop 01', { timeout: 30_000 });
	await shot('finding-show-in-gantt');
});

test('a tablet gets the bottom sheet from the Health button (light)', async ({ page }, info) => {
	test.skip(isTouch(info), 'the desktop project, resized to a tablet');
	await page.setViewportSize({ width: 820, height: 1180 });
	const shot = shooter(page, info, 'light');
	fs.mkdirSync(DIR, { recursive: true });
	await openPlan(page, info, 'light');
	await page.getByTestId('health-button').click();
	const sheet = page.getByRole('dialog', { name: 'Plan health' });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByTestId('health-summary')).toContainText('241 problems', {
		timeout: READY_TIMEOUT_MS,
	});
	await page.waitForTimeout(600);
	await page.screenshot({ path: path.join(DIR, 't18-health-sheet-tablet-820-light.png') });
	void shot;
});

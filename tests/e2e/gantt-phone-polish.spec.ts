// SPDX-License-Identifier: GPL-2.0-or-later
// Phone behaviour from the Phase 2 polish list (docs/phases/phase-2-polish.md items 6 and 9): the
// Plan tab's outline is not in the page while another tab shows, and comes back where it was; the
// floating task pill leaves the last row a place to scroll to.
import { expect, test, type Page } from '@playwright/test';

const READY_TIMEOUT_MS = 120_000;

async function open(page: Page, sample: string): Promise<void> {
	await page.goto(`/app?sample=${sample}`);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.locator('[role="row"][data-key]').first()).toBeVisible();
}

test.describe('phone polish', () => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	test('the hidden Plan tab has no outline mounted, and the tab keeps its scroll', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'pixel-7');
		await open(page, 'gantt-500');
		const trees = page.locator('#panel-plan [role="tree"]');
		await expect(trees).toHaveCount(0);

		await page.getByRole('tab', { name: 'Plan', exact: true }).click();
		const tasks = page.getByRole('tree', { name: 'Tasks' });
		await expect(tasks).toBeVisible();
		const scroller = tasks.locator('xpath=..');
		await scroller.evaluate((el) => (el.scrollTop = 900));
		await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(900);
		// A row in view; selecting it shows its declaration: the phone moves to the Text tab.
		const selectedKey = await scroller.evaluate((el) => {
			const top = el.getBoundingClientRect().top;
			const rows = [...el.querySelectorAll<HTMLElement>('[role="treeitem"]')];
			return rows.find((r) => r.getBoundingClientRect().top > top + 20)?.dataset['key'] ?? '';
		});
		expect(selectedKey).not.toBe('');
		await tasks.locator(`[data-key="${selectedKey}"]`).click();

		await page.getByRole('tab', { name: 'Gantt', exact: true }).click();
		await expect(page.locator('#panel-gantt')).toBeVisible();
		await expect(trees).toHaveCount(0);
		// The page is far smaller without it: the plan's 500 rows are not in it twice.
		expect(await page.evaluate(() => document.querySelectorAll('*').length)).toBeLessThan(2500);

		await page.getByRole('tab', { name: 'Plan', exact: true }).click();
		const back = page.getByRole('tree', { name: 'Tasks' });
		await expect(back).toBeVisible();
		await expect
			.poll(() => back.locator('xpath=..').evaluate((el) => el.scrollTop))
			.toBeGreaterThan(890);
		await expect(back.locator('[aria-selected="true"]')).toHaveAttribute('data-key', selectedKey);
	});

	test('the task pill leaves room to scroll the last row clear of it', async ({ page }, info) => {
		test.skip(info.project.name !== 'pixel-7');
		await open(page, 'upstream-fedora-20');
		const gantt = page.getByTestId('gantt');
		// Nothing selected: the pill says the whole critical path is before the status date.
		const pill = gantt.locator('p.task[role="status"]:not(.sr-only)');
		await expect(pill).toBeVisible();
		await gantt.evaluate((g) => {
			const s = g.querySelector('.scroller');
			if (s) s.scrollTop = s.scrollHeight;
		});
		await page.waitForTimeout(400);
		const last = gantt.locator('[role="row"][data-key]').last();
		const [row, box] = await Promise.all([last.boundingBox(), pill.boundingBox()]);
		expect(row && box).toBeTruthy();
		expect((row?.y ?? 0) + (row?.height ?? 0)).toBeLessThanOrEqual((box?.y ?? 0) + 1);
	});
});

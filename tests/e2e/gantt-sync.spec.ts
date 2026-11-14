// SPDX-License-Identifier: GPL-2.0-or-later
// Selection sync across the two files of the gantt-manipulation sample (phase-2.md 6.10, 13.2):
// selection-sync.spec.ts covers the entry file; this covers lib/build.tji, in both directions.
// A row of a task declared in the included file opens that file in the editor and puts the task's
// block on show; the cursor in either file selects its row. Desktop Chrome (Split) and Pixel 7
// (the Gantt and Text tabs). Mode shortcuts and their persistence are in modes-layout.spec.ts.
import { expect, test, type Locator, type Page } from '@playwright/test';

const READY_TIMEOUT_MS = 120_000;
type Info = { project: { name: string } };
const phone = (info: Info) => info.project.name !== 'desktop';

const row = (page: Page, name: string): Locator =>
	page.locator('[role="treegrid"] [role="row"][data-key]').filter({ hasText: name }).first();
const line = (page: Page, text: string): Locator =>
	page.locator('.cm-content .cm-line').filter({ hasText: text }).first();
/** The open file: a tab on a desktop, the File menu on a phone. */
async function expectFile(page: Page, info: Info, file: string): Promise<void> {
	if (phone(info)) await expect(page.getByRole('combobox', { name: 'File' })).toHaveValue(file);
	else await expect(page.getByRole('tab', { name: file })).toHaveAttribute('aria-selected', 'true');
}
async function openFile(page: Page, info: Info, file: string): Promise<void> {
	if (phone(info)) await page.getByRole('combobox', { name: 'File' }).selectOption(file);
	else await page.getByRole('tab', { name: file }).click();
	await expectFile(page, info, file);
}

async function tab(page: Page, info: Info, name: 'Text' | 'Gantt'): Promise<void> {
	if (!phone(info)) return;
	await page.getByRole('tab', { name, exact: true }).click();
	await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
		'aria-selected',
		'true',
	);
}

/** A line of the text, scrolled to: the editor draws only the lines in or near its view. */
async function lineAt(page: Page, text: string): Promise<Locator> {
	const target = line(page, text);
	for (let i = 0; i < 60 && (await target.count()) === 0; i++) {
		await page.locator('.cm-scroller').evaluate((e) => void (e.scrollTop += e.clientHeight / 2));
		await page.waitForTimeout(40);
	}
	await target.scrollIntoViewIfNeeded();
	return target;
}

test.describe('selection sync across files', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T21); iPhone is reported');
	});

	test('a row of a task in lib/build.tji opens that file; the cursor in either file selects its row', async ({
		page,
	}, info) => {
		await page.goto(`/app?sample=gantt-manipulation${phone(info) ? '' : '&mode=split'}`);
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(row(page, 'Research')).toBeVisible();
		await page.waitForTimeout(500);

		// Gantt to text: the task is declared in the included file.
		await row(page, 'Write code').click();
		await expect(row(page, 'Write code')).toHaveAttribute('aria-selected', 'true');
		await tab(page, info, 'Text');
		await expectFile(page, info, 'lib/build.tji');
		const lit = page.locator('.cm-content .cm-line.cm-source-selected');
		await expect(lit.first()).toContainText('task code "Write code"');

		// Text to Gantt, in that file: a line of Write tests.
		await (await lineAt(page, 'effort 3d')).click();
		await tab(page, info, 'Gantt');
		await expect(row(page, 'Write tests')).toHaveAttribute('aria-selected', 'true');
		await expect(row(page, 'Write code')).toHaveAttribute('aria-selected', 'false');

		// And in the entry file, after switching to it by its tab.
		await tab(page, info, 'Text');
		await openFile(page, info, 'plan.tjp');
		await (await lineAt(page, 'duration 2d')).click();
		await tab(page, info, 'Gantt');
		await expect(row(page, 'Review')).toHaveAttribute('aria-selected', 'true');
		await expect(row(page, 'Write tests')).toHaveAttribute('aria-selected', 'false');
	});
});

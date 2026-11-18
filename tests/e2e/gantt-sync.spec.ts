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
	page
		.locator('[role="treegrid"] [role="row"][data-key]')
		.filter({ has: page.locator('[data-col="name"] .label', { hasText: name }) })
		.first();
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

/**
 * A line of the text, scrolled to and inside the editor's view: the editor draws only the lines in
 * or near its view, and (WebKit more) replaces the ones it scrolls past. A click that has to scroll
 * to a line is retried by Playwright each time the line is replaced, and can go on for ever, so the
 * line is first brought into view here, by script, and the click finds it where it is.
 */
async function lineAt(page: Page, text: string): Promise<Locator> {
	await expect
		.poll(
			() =>
				page.evaluate((t) => {
					const scroller = document.querySelector<HTMLElement>('.cm-scroller');
					if (!scroller) return false;
					const el = [...document.querySelectorAll('.cm-content .cm-line')].find((l) =>
						l.textContent?.includes(t),
					);
					if (!el) {
						scroller.scrollTop += scroller.clientHeight / 2;
						return false;
					}
					const at = el.getBoundingClientRect();
					const view = scroller.getBoundingClientRect();
					if (at.top >= view.top + 4 && at.bottom <= view.bottom - 4) return true;
					scroller.scrollTop += at.top - view.top - view.height / 2;
					return false;
				}, text),
			{ timeout: 30_000, intervals: [40, 80, 160] },
		)
		.toBe(true);
	return line(page, text);
}

test.describe('selection sync across files', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);

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

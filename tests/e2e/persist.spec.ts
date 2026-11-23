// SPDX-License-Identifier: GPL-2.0-or-later
// Plans kept in the browser (phase-4.md 7.1, 9.4, 13.2, 18.7; T4), on a small plan, on every
// project: a sample's first change stores a copy, a reload opens it with the change and an empty
// undo history that says so, the sample itself is unchanged, and a `?sample=` link still opens the
// sample; a second page on the plan is read-only until "Open here instead", which makes the first
// one read-only; and storage the browser cleared is said once. Each test has a fresh browser
// context, so nothing stored leaks from one test to the next.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { historyStrings, strings } from '../../src/lib/strings';
import { storageStrings } from '../../src/lib/strings-storage';
import { READY_TIMEOUT_MS, editor, openApp } from './lib/text-mode';
import { modKey } from './lib/keys';

const SAMPLE = 'ui-basic';
const LABEL = strings.samples[SAMPLE];
const COPY = strings.keep.copy(LABEL);
const chooser = (page: Page) => page.getByLabel(strings.topBar.sample);
const notice = (page: Page) => page.getByTestId('plan-notice');

test.setTimeout(READY_TIMEOUT_MS * 2 + 60_000);

/** Puts the cursor at the start of the open file and types `line` there. */
async function typeAtStart(page: Page, line: string): Promise<void> {
	await editor(page).click();
	await page.keyboard.press(`${await modKey(page)}+Home`);
	await page.keyboard.insertText(line);
}

/** The plan is stored as its copy: the address no longer names the sample (App.svelte). */
async function stored(page: Page): Promise<void> {
	await expect(page).not.toHaveURL(/[?&]sample=/, { timeout: 10_000 });
	await expect(chooser(page).locator('option:checked')).toHaveText(COPY);
}

/**
 * The file texts the local store holds now, read from IndexedDB in the page (once the plan is
 * stored: before that, opening the database here would make an empty one).
 */
function storedTexts(page: Page): Promise<string[]> {
	return page.evaluate(
		() =>
			new Promise<string[]>((resolve) => {
				const r = indexedDB.open('mainspring');
				r.onerror = () => resolve([]);
				r.onsuccess = () => {
					const db = r.result;
					const q = db.transaction('files').objectStore('files').getAll();
					q.onsuccess = () => {
						db.close();
						resolve(q.result as string[]);
					};
				};
			}),
	);
}

/** Waits until autosave has stored a file holding `text`. */
async function kept(page: Page, text: string): Promise<void> {
	await expect.poll(async () => (await storedTexts(page)).some((t) => t.includes(text))).toBe(true);
}

async function ready(page: Page): Promise<void> {
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(editor(page)).toBeVisible();
}

test("a sample's first change stores a copy, which a reload opens; the sample stays as it was", async ({
	page,
}) => {
	await openApp(page, SAMPLE);
	await expect(chooser(page).locator('option:checked')).toHaveText(LABEL);
	// Desktop and tablet say where the plan is; a phone has no footer line.
	const line = page.getByTestId('keep-line');
	if (await line.isVisible()) await expect(line).toHaveText(strings.keep.sample);

	await typeAtStart(page, '# kept in this browser\n');
	await stored(page);
	if (await line.isVisible()) await expect(line).toHaveText(strings.keep.stored);
	// A change after the copy is stored too.
	await typeAtStart(page, '# and this\n');
	await kept(page, '# and this');

	await page.reload();
	await ready(page);
	await expect(chooser(page).locator('option:checked')).toHaveText(COPY);
	await expect(editor(page)).toContainText('# and this');
	await expect(editor(page)).toContainText('# kept in this browser');
	// The undo history starts empty, and the first undo says why (7.1).
	await editor(page).click();
	await page.keyboard.press(`${await modKey(page)}+z`);
	await expect(page.getByText(historyStrings.reopened).first()).toBeVisible();
	await expect(editor(page)).toContainText('# and this');

	// The sample itself never changed.
	await chooser(page).selectOption({ label: LABEL });
	await expect(chooser(page).locator('option:checked')).toHaveText(LABEL);
	await expect(editor(page)).not.toContainText('# kept in this browser');
	// The last plan is the sample now; the copy is still kept (the chooser of T15 lists it).
	await page.reload();
	await ready(page);
	await expect(chooser(page).locator('option:checked')).toHaveText(LABEL);

	// A `?sample=` link opens the sample, whatever the last plan was.
	await openApp(page, 'ui-people');
	await expect(chooser(page).locator('option:checked')).toHaveText(strings.samples['ui-people']);
});

test('a second page on the plan is read-only; "Open here instead" takes it, with the newest text', async ({
	page,
	context,
}) => {
	await openApp(page, SAMPLE);
	await typeAtStart(page, '# first page\n');
	await stored(page);

	// The last plan opens in the second page, which another page has.
	const second = await context.newPage();
	await second.goto('/app?mode=text');
	await ready(second);
	await expect(notice(second)).toContainText(storageStrings.notice.elsewhere);
	const axe = await new AxeBuilder({ page: second })
		.include('[data-testid="plan-notice"]')
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(axe.violations).toEqual([]);
	await expect(editor(second)).toHaveAttribute('contenteditable', 'false');
	await expect(editor(second)).toContainText('# first page');
	const line = second.getByTestId('keep-line');
	if (await line.isVisible()) await expect(line).toHaveText(strings.keep.readOnly);

	// The first page types once more; the second takes the plan and has that text too.
	await page.bringToFront();
	await typeAtStart(page, '# just before\n');
	await second.bringToFront();
	await notice(second).getByRole('button', { name: storageStrings.notice.openHere }).click();
	await expect(notice(second)).toBeHidden();
	await expect(editor(second)).toHaveAttribute('contenteditable', 'true');
	await expect(editor(second)).toContainText('# just before');

	// The first page is read-only now, and says why.
	await expect(notice(page)).toContainText(storageStrings.notice.taken);
	await expect(editor(page)).toHaveAttribute('contenteditable', 'false');

	// The second page's changes are kept: a third page shows them read-only.
	await typeAtStart(second, '# second page\n');
	await kept(second, '# second page');
	const third = await context.newPage();
	await third.goto('/app?mode=text');
	await ready(third);
	await expect(editor(third)).toContainText('# second page');
	await expect(notice(third)).toContainText(storageStrings.notice.elsewhere);

	// And the first page can take it back.
	await page.bringToFront();
	await notice(page).getByRole('button', { name: storageStrings.notice.openHere }).click();
	await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
	await expect(editor(page)).toContainText('# second page');
});

test('says once that the browser cleared the plans it kept', async ({ page }) => {
	await openApp(page, SAMPLE);
	await typeAtStart(page, '# soon gone\n');
	await stored(page);
	// The browser clears the site's IndexedDB but not localStorage: the marker's half there stays.
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				const r = indexedDB.deleteDatabase('mainspring');
				r.onsuccess = r.onerror = () => resolve();
			}),
	);
	await openApp(page, SAMPLE);
	await expect(notice(page)).toContainText(storageStrings.notice.cleared);
	await expect(editor(page)).not.toContainText('# soon gone');
	await notice(page).getByRole('button', { name: storageStrings.notice.dismiss }).click();
	await expect(notice(page)).toBeHidden();
	// Said once: the next visit does not say it again.
	await openApp(page, SAMPLE);
	await expect(chooser(page).locator('option:checked')).toHaveText(LABEL);
	await expect(notice(page)).toBeHidden();
});

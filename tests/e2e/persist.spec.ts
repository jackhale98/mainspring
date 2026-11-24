// SPDX-License-Identifier: GPL-2.0-or-later
// Plans kept in the browser (phase-4.md 7.1, 9.4, 13.2, 18.7; T4), on a small plan, on every
// project: a sample's first change stores a copy, a reload opens it with the change and an empty
// undo history that says so, the sample itself is unchanged, and a `?sample=` link still opens the
// sample; a second page on the plan is read-only until "Open here instead", which makes the first
// one read-only; changes another page took the plan before were stored are said not kept, with
// the text to copy (T4 re-check N1); and storage the browser cleared is said once. Each test has a
// fresh browser context, so nothing stored leaks from one test to the next.
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
const yourPlans = (page: Page) =>
	chooser(page).locator(`optgroup[label="${strings.newPlan.yourPlans}"]`);

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
	// The top bar's sync control says where the plan is, on every layout (T14).
	const sync = page.getByTestId('sync-status');
	await expect(sync).toHaveAttribute('data-kind', 'sample');

	await typeAtStart(page, '# kept in this browser\n');
	await stored(page);
	await expect(sync).toHaveAttribute('data-kind', 'browser-only');
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
	// The last plan is the sample now; the copy is still kept, and the chooser lists it.
	await page.reload();
	await ready(page);
	await expect(chooser(page).locator('option:checked')).toHaveText(LABEL);
	await expect(yourPlans(page).locator('option')).toHaveText([COPY]);

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
	// Nothing offers an edit there (T4 review L4): no Add task on the chart, Undo and Redo off.
	const phone = await second.getByRole('tab', { name: 'Gantt', exact: true }).isVisible();
	if (phone) await second.getByRole('tab', { name: 'Gantt', exact: true }).click();
	else await second.getByRole('button', { name: 'Visual', exact: true }).click();
	await expect(second.getByTestId('gantt')).toBeVisible();
	await expect(second.getByTestId('add-task')).toHaveCount(0);
	for (const b of await second
		.getByRole('group', { name: strings.topBar.history })
		.getByRole('button')
		.all())
		await expect(b).toBeDisabled();
	if (phone) await second.getByRole('tab', { name: 'Text', exact: true }).click();
	else await second.getByRole('button', { name: 'Text', exact: true }).click();
	await expect(second.getByTestId('sync-status')).toHaveAttribute('data-kind', 'read-only');

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

	// And the first page can take it back, and what it types then is kept (T4 review H1: a plan
	// opened again starts its versions at 0).
	await page.bringToFront();
	await notice(page).getByRole('button', { name: storageStrings.notice.openHere }).click();
	await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
	await expect(editor(page)).toContainText('# second page');
	await typeAtStart(page, '# A again\n');
	await kept(page, '# A again');
	await page.reload();
	await ready(page);
	await expect(notice(page)).toBeHidden();
	await expect(editor(page)).toContainText('# A again');
	await expect(editor(page)).toContainText('# second page');
});

test('changes another page took the plan before were stored are said not kept, and can be copied (N1)', async ({
	page,
	context,
}) => {
	// An old browser, without Web Locks or BroadcastChannel: both pages edit the plan, and the
	// store's owner epoch refuses the saves of the page that opened it first. The clipboard
	// records what is copied.
	await context.addInitScript(() => {
		Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
		Reflect.deleteProperty(window, 'BroadcastChannel');
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: (t: string) => {
					(window as unknown as { copied: string }).copied = t;
					return Promise.resolve();
				},
			},
		});
	});
	await openApp(page, SAMPLE);
	await typeAtStart(page, '# first page\n');
	await stored(page);
	await kept(page, '# first page');
	const second = await context.newPage();
	await second.goto('/app?mode=text');
	await ready(second);
	await expect(editor(second)).toHaveAttribute('contenteditable', 'true');
	await expect(notice(second)).toBeHidden();

	// The first page types; the store refuses it: the page says so, read-only, text on screen.
	await page.bringToFront();
	await typeAtStart(page, '# not kept\n');
	await expect(notice(page)).toHaveAttribute('data-kind', 'refused', { timeout: 10_000 });
	await expect(notice(page)).toContainText(storageStrings.notice.refused);
	await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
	await expect(editor(page)).toContainText('# not kept');
	await expect(page.getByTestId('sync-status')).toHaveAttribute('data-kind', 'failed');
	const axe = await new AxeBuilder({ page })
		.include('[data-testid="plan-notice"]')
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(axe.violations).toEqual([]);
	expect(await storedTexts(page)).not.toContainEqual(expect.stringContaining('# not kept'));

	// "Copy the text" puts the open file's text on the clipboard.
	await notice(page).getByRole('button', { name: storageStrings.notice.copyText }).click();
	await expect(
		notice(page).getByRole('button', { name: storageStrings.notice.copied }),
	).toBeVisible();
	const copied = await page.evaluate(() => (window as unknown as { copied?: string }).copied);
	expect(copied).toContain('# not kept\n# first page\n');

	// "Open here instead" asks first; no keeps the text on screen.
	const asked: string[] = [];
	page.once('dialog', (d) => {
		asked.push(d.message());
		void d.dismiss();
	});
	const openHere = notice(page).getByRole('button', { name: storageStrings.notice.openHere });
	await openHere.click();
	await expect.poll(() => asked).toEqual([strings.keep.confirmTake]);
	await expect(notice(page)).toHaveAttribute('data-kind', 'refused');
	await expect(editor(page)).toContainText('# not kept');
	// Yes opens the plan here as it is stored, editable.
	page.once('dialog', (d) => void d.accept());
	await openHere.click();
	await expect(notice(page)).toBeHidden();
	await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
	await expect(editor(page)).toContainText('# first page');
	await expect(editor(page)).not.toContainText('# not kept');
});

test('the chooser lists the plans kept here; one opens with its edit (T4 review H2)', async ({
	page,
}) => {
	await openApp(page, 'upstream-tutorial');
	await typeAtStart(page, '# my tutorial\n');
	await expect(page).not.toHaveURL(/[?&]sample=/, { timeout: 10_000 });
	await kept(page, '# my tutorial');
	// The editor still has the focus: the switch shows the other plan's text (no question first).
	await chooser(page).selectOption({ label: LABEL });
	await expect(chooser(page).locator('option:checked')).toHaveText(LABEL);
	await expect(editor(page)).toContainText('ui-basic');
	await expect(editor(page)).not.toContainText('# my tutorial');
	await page.reload();
	await ready(page);
	const tutorialCopy = strings.keep.copy(strings.samples['upstream-tutorial']);
	await expect(yourPlans(page).locator('option')).toHaveText([tutorialCopy]);
	const axe = await new AxeBuilder({ page })
		.include('header')
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(axe.violations).toEqual([]);
	await chooser(page).selectOption({ label: tutorialCopy });
	await expect(chooser(page).locator('option:checked')).toHaveText(tutorialCopy);
	await expect(editor(page)).toContainText('# my tutorial');
});

test('a switch right after typing, the editor still focused, shows the other plan', async ({
	page,
}) => {
	// Switching asks nothing now (the plan is kept): the old editor still has the focus when the
	// new plan's first result comes, and its cursor must not be read in the new text.
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await openApp(page, SAMPLE);
	await typeAtStart(page, '# kept\n');
	await stored(page);
	await chooser(page).selectOption({ label: strings.samples['ui-people'] });
	await expect(chooser(page).locator('option:checked')).toHaveText(strings.samples['ui-people']);
	await expect(editor(page)).toContainText('ui-people');
	await expect(editor(page)).not.toContainText('# kept');
	expect(errors).toEqual([]);
});

test('when the kept plan cannot be opened, a sample opens, the notice says so, and the plan comes back (H2)', async ({
	page,
}) => {
	// The browser's storage refuses to open while `block-idb` is set (a private window, a blocked
	// site): the same on every engine, unlike a blocked chunk that a cache may still serve.
	await page.addInitScript(() => {
		const w = window as unknown as { blockIdb?: boolean };
		w.blockIdb = sessionStorage.getItem('block-idb') === '1';
		// Patched on the prototype: a property set on `indexedDB` itself lives on a wrapper object
		// that WebKit may collect and make again, which un-blocked the storage on CI.
		const open = IDBFactory.prototype.open;
		IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
			if (w.blockIdb) throw new DOMException('blocked', 'SecurityError');
			return open.call(this, name, version);
		};
	});
	await openApp(page, SAMPLE);
	await typeAtStart(page, '# still here\n');
	await stored(page);
	await kept(page, '# still here');
	await page.evaluate(() => sessionStorage.setItem('block-idb', '1'));
	await page.reload();
	await ready(page);
	await expect(notice(page)).toContainText(storageStrings.notice.unopened);
	await expect(chooser(page).locator('option:checked')).toHaveText(strings.samples['poc-sample']);
	await expect(editor(page)).not.toContainText('# still here');
	// The pointer to the plan is left alone: once the storage opens again, so does the plan.
	await page.evaluate(() => {
		sessionStorage.removeItem('block-idb');
		(window as unknown as { blockIdb?: boolean }).blockIdb = false;
	});
	await notice(page).getByRole('button', { name: storageStrings.notice.retry }).click();
	await expect(notice(page)).toBeHidden();
	await expect(editor(page)).toContainText('# still here');
	await expect(chooser(page).locator('option:checked')).toHaveText(COPY);
	// A reload opens it again as the last plan.
	await page.reload();
	await ready(page);
	await expect(editor(page)).toContainText('# still here');
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

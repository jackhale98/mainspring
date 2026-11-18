// SPDX-License-Identifier: GPL-2.0-or-later
// The dependency picker in the phone's details sheet (polish row 18, a real iPhone, 2026-11-18):
// - focusing its search box zoomed the whole page, because iOS Safari zooms into any field whose
//   text is under 16 px. On a coarse pointer every field has a computed font size of at least 16 px
//   (Base.astro; the viewport still zooms, WCAG 1.4.4). The fields of the other phone states are
//   checked too, since the rule is global: the details, the calendar's day sheet, the new-plan
//   sheet, a health finding's gap editor and the editor's text;
// - its list was a strip of a few rows. The sheet goes to full height when the picker opens, the
//   list fills what is left (more than half the screen), its rows are 44 px, and the search box
//   stays above the list while the list scrolls.
// The pictures (SCREENSHOTS=1, SHOT_TAG=before for the build before) are
// docs/phases/screenshots/phase-3/picker-phone-*.png.
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { openCalendar, openDetails as openDayDetails } from './lib/calendar-rig';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { WIKI_TASK, openHealthRow } from './lib/select-states';
import { ready } from './lib/sheet-rig';

test.setTimeout(READY_TIMEOUT_MS * 3);
test.beforeEach(({ browserName: _b }, info) => {
	test.skip(!isTouch(info), 'a finger: the phone sheets');
});
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');
const TAG = process.env['SHOT_TAG'] ? `-${process.env['SHOT_TAG']}` : '';
const shot = async (page: Page, name: string, info: TestInfo): Promise<void> => {
	if (!process.env['SCREENSHOTS']) return;
	const device = info.project.name === 'iphone-14' ? 'iphone14' : 'pixel7';
	await page.screenshot({ path: path.join(DIR, `picker-phone-${name}-${device}${TAG}.png`) });
};

const FIELDS =
	'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="file"]):not([type="color"]), .cm-content';

/** The visible fields whose computed font size is under 16 px (a field that iOS would zoom to). */
const small = (page: Page): Promise<string[]> =>
	page.evaluate((sel) => {
		const out: string[] = [];
		for (const el of document.querySelectorAll<HTMLElement>(sel)) {
			if (el.getClientRects().length === 0) continue;
			const px = parseFloat(getComputedStyle(el).fontSize);
			if (px < 16) {
				const name = el.getAttribute('aria-label') ?? el.id ?? el.className;
				out.push(`${el.tagName.toLowerCase()} ${name}: ${px}px`);
			}
		}
		return out;
	}, FIELDS);

async function expectBig(page: Page, what: string): Promise<void> {
	const count = await page.evaluate(
		(sel) =>
			[...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0).length,
		FIELDS,
	);
	expect(count, `${what}: a field is on screen`).toBeGreaterThan(0);
	expect(await small(page), `${what}: every field is 16 px or more`).toEqual([]);
}

const SHEET = 'dialog.sheet[data-modal="false"][open]';

async function openTaskDetails(page: Page): Promise<void> {
	await page.goto('/app?sample=gantt-manipulation&mode=visual&hooks=edits');
	await ready(page);
	const row = page
		.locator('[role="treegrid"] [role="row"][data-key]')
		.filter({ has: page.locator('[data-col="name"] .label', { hasText: 'Research' }) })
		.first();
	await expect(row).toBeVisible();
	await page.waitForTimeout(500);
	await row.click();
	const panel = page.getByRole('dialog', { name: /Task details/ });
	if ((await panel.count()) === 0) await row.click();
	await expect(panel.getByLabel('Name', { exact: true })).toHaveValue('Research');
	await page.waitForTimeout(600);
}

test('the picker: the sheet goes full, the list fills it with 44 px rows, the search box stays', async ({
	page,
}, info) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await openTaskDetails(page);
	const sheet = page.locator(SHEET);
	await expect(sheet).toHaveAttribute('data-detent', 'half');
	await shot(page, '1-details', info);
	await page.getByRole('button', { name: 'Add a task this one waits for' }).tap();
	const picker = page.getByTestId('depends-picker');
	await expect(picker).toBeVisible();
	const search = page.getByRole('combobox', { name: 'Find a task this one waits for' });
	await search.tap();
	await expect(search).toBeFocused();
	await expect(picker.getByRole('option').first()).toBeVisible();
	await page.waitForTimeout(900);
	await shot(page, '2-open', info);

	await expect(sheet, 'the sheet has the height the list needs').toHaveAttribute(
		'data-detent',
		'full',
	);
	const view = page.viewportSize()?.height ?? 0;
	const list = picker.getByRole('listbox');
	const box = await list.boundingBox();
	const sheetBox = await sheet.boundingBox();
	const searchBox = await search.boundingBox();
	if (!box || !sheetBox || !searchBox) throw new Error('no box');
	expect(box.height, 'the list is more than half the screen').toBeGreaterThan(view * 0.5);
	expect(box.y + box.height, 'the list ends inside the sheet').toBeLessThanOrEqual(
		sheetBox.y + sheetBox.height + 1,
	);
	expect(searchBox.y, 'the search box is above the list').toBeLessThan(box.y);
	expect(searchBox.y, 'and on screen, below the sheet header').toBeGreaterThan(sheetBox.y);
	// The rows are 44 px or more.
	const rows = await picker
		.getByRole('option')
		.evaluateAll((els) => els.slice(0, 8).map((e) => e.getBoundingClientRect().height));
	for (const h of rows) expect(h).toBeGreaterThanOrEqual(43.5);
	// The list scrolls under a search box that stays where it is.
	const before = await search.boundingBox();
	await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
	await page.waitForTimeout(150);
	const after = await search.boundingBox();
	expect(after?.y).toBeCloseTo(before?.y ?? -1, 0);
	// A scroll the person did not make (WebKit's own scroll to a focused field, late on a busy
	// phone) does not leave the list below the sheet: the picker comes back to the top.
	await sheet.locator('.content').evaluate((el) => (el.scrollTop = 0));
	await expect
		.poll(async () => (await search.boundingBox())?.y ?? -1, { message: 'the picker is back' })
		.toBeCloseTo(before?.y ?? -1, 0);
	await expectBig(page, 'the open picker');

	// Choosing closes it, and the sheet goes back to the height it had.
	await page.keyboard.press('Escape');
	await expect(picker).toHaveCount(0);
	await expect(sheet).toHaveAttribute('data-detent', 'half');
});

test('every field is 16 px or more on a finger, so that iOS does not zoom (details, text)', async ({
	page,
}) => {
	await openTaskDetails(page);
	await expectBig(page, 'the task details');
	await page.goto('/app?sample=syn-18-structure-include-macro&mode=text');
	await ready(page);
	await page.getByRole('tab', { name: 'Text', exact: true }).tap();
	await expect(page.locator('.cm-content')).toBeVisible();
	await expectBig(page, 'the editor');
});

test('every field is 16 px or more on a finger (the day sheet, the new-plan sheet)', async ({
	page,
}, info) => {
	await openCalendar(page, info);
	await openDayDetails(page, info, '2026-11-20');
	await page.waitForTimeout(600);
	await expectBig(page, 'the day details');
	await page.goto('/app?sample=gantt-manipulation&mode=visual');
	await ready(page);
	await page.getByLabel('Sample plan').selectOption({ label: 'New plan…' });
	await expect(page.getByRole('dialog', { name: /New plan/ })).toBeVisible();
	await page.waitForTimeout(500);
	await expectBig(page, 'the new-plan sheet');
});

test('every field is 16 px or more on a finger (a health finding’s gap editor)', async ({
	page,
}, info) => {
	const row = await openHealthRow(page, info, 'long-gap', WIKI_TASK);
	await row.locator('[data-fix="setDependsGap"]').tap();
	await expect(row.getByRole('textbox', { name: 'Gap', exact: true })).toBeVisible();
	await expectBig(page, 'the gap editor');
});

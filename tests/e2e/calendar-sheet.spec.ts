// SPDX-License-Identifier: GPL-2.0-or-later
// The Calendar's day details on a phone (Pixel 7 and iPhone 14) are the shared bottom Sheet, as the
// task details are (user, 2026-11-17: on a real iPhone the old panel jumped in, sat in 170 px
// between the month and the toolbars, and scrolled inside itself). What is checked:
// - it is a non-modal dialog that ends on the tab bar, with the days as its title;
// - the month stays where it is when the selected day is already above the sheet, and scrolls only
//   as far as it must when the day would be under it (and the day ends above the sheet either way);
// - at half height "Add leave" and its button are in reach with nothing scrolling, a day with leave
//   has one scroll area (the sheet's), never two;
// - Escape and Close slide it away and the focus returns to the day;
// - a second tap on another day keeps the sheet and moves the selection.
// The slide itself (transform only, up and down) is checked in phone-bugfixes.spec.ts. The pictures
// (SCREENSHOTS=1) are docs/phases/screenshots/phase-3/calendar-sheet-*.png: half, full, and frames
// of the slide (made slow with --sheet-ms so that a screenshot can catch them).
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { day, openCalendar, openDetails, showDay, tapDay } from './lib/calendar-rig';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';

test.setTimeout(READY_TIMEOUT_MS * 2);
test.beforeEach(({ browserName: _b }, info) => {
	test.skip(!isTouch(info), 'the phone sheet');
});
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');
const device = (info: TestInfo): string =>
	info.project.name === 'iphone-14' ? 'iphone14' : 'pixel7';
const shot = async (page: Page, name: string, info: TestInfo): Promise<void> => {
	if (!process.env['SCREENSHOTS']) return;
	await page.screenshot({
		path: path.join(DIR, `calendar-sheet-${name}-${device(info)}.png`),
	});
};

const SHEET = 'dialog.sheet[data-modal="false"][open]';
const settle = async (page: Page): Promise<void> => {
	await page
		.locator(SHEET)
		.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
	await page.waitForTimeout(450);
};
const scrollTop = (page: Page): Promise<number> =>
	page.getByTestId('cal-scroller').evaluate((el) => el.scrollTop);
/** The sheet's top, and a day's bottom, in the viewport. */
const edges = (
	page: Page,
	date: string,
): Promise<{ sheetTop: number; dayBottom: number; dayTop: number }> =>
	page.evaluate(
		({ sheet, sel }) => {
			const s = document.querySelector(sheet)?.getBoundingClientRect();
			const d = document.querySelector(sel)?.getBoundingClientRect();
			return { sheetTop: s?.top ?? NaN, dayBottom: d?.bottom ?? NaN, dayTop: d?.top ?? NaN };
		},
		{ sheet: SHEET, sel: `[data-testid="cal-day"][data-date="${date}"]` },
	);

test('it is the shared non-modal sheet: titled by the days, ending on the tab bar', async ({
	page,
}, info) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await openCalendar(page, info);
	await openDetails(page, info, '2026-11-20');
	await settle(page);
	const sheet = page.getByRole('dialog', { name: 'Fri, Nov 20, 2026' });
	await expect(sheet).toBeVisible();
	await expect(sheet).toHaveAttribute('data-modal', 'false');
	await expect(sheet).toHaveAttribute('data-detent', 'half');
	const box = await sheet.boundingBox();
	const tabs = await page.getByRole('tablist', { name: 'Panels' }).boundingBox();
	const view = page.viewportSize();
	expect(box && tabs && view).toBeTruthy();
	if (!box || !tabs || !view) return;
	// Its foot is on the tab bar's clearance, as the task details' is, not behind it nor above a gap.
	expect(box.y + box.height).toBeLessThanOrEqual(tabs.y + 1);
	expect(tabs.y - (box.y + box.height), 'no more than the tab bar gap').toBeLessThan(24);
	// Half the room, not 170 px.
	expect(box.height).toBeGreaterThan(view.height * 0.35);
	// The old status line and the toolbar rows are under it, not squeezed beside it.
	for (const t of ['cal-line', 'cal-mode-select']) {
		const el = page.getByTestId(t);
		if (!(await el.isVisible())) continue;
		const b = await el.boundingBox();
		if (b) expect(b.y, `${t} is under the sheet`).toBeGreaterThanOrEqual(box.y - 1);
	}
	await shot(page, 'half', info);
});

test('at half height Add leave and all the details show without scrolling', async ({
	page,
}, info) => {
	await openCalendar(page, info);
	await openDetails(page, info, '2026-11-20');
	await settle(page);
	const sheet = page.locator(SHEET);
	const add = page.getByTestId('cal-add');
	await expect(add).toBeVisible();
	const a = await add.boundingBox();
	const s = await sheet.boundingBox();
	if (!a || !s) throw new Error('no box');
	expect(a.y + a.height, 'the button ends inside the sheet').toBeLessThanOrEqual(s.y + s.height);
	// Everything shows: what is left to scroll at half height is the content area's bottom padding.
	const hidden = await sheet.evaluate((el) => {
		const c = el.querySelector<HTMLElement>('.content');
		if (!c) return NaN;
		return c.scrollHeight - c.clientHeight - (parseFloat(getComputedStyle(c).paddingBottom) || 0);
	});
	expect(
		hidden,
		'all of the details show at half height for a day with no leave',
	).toBeLessThanOrEqual(1);
	// Full height: the same content, still nothing scrolling.
	await sheet.getByRole('button', { name: /Details height/ }).tap();
	await expect(sheet).toHaveAttribute('data-detent', 'full');
	await settle(page);
	await expect(add).toBeVisible();
	await shot(page, 'full', info);
});

test('adding leave from the sheet shows its card, and only the sheet scrolls', async ({
	page,
}, info) => {
	await openCalendar(page, info);
	await openDetails(page, info, '2026-11-20');
	await settle(page);
	const sheet = page.locator(SHEET);
	await page.getByTestId('cal-add-name').fill('Test day');
	await page.getByTestId('cal-add').tap();
	await expect(sheet.getByTestId('cal-leave')).toHaveCount(1, { timeout: 30_000 });
	// The card is above the form now (the form is first only while there is nothing to edit).
	const order = await sheet.evaluate((el) => {
		const card = el.querySelector('[data-testid="cal-leave"]')?.getBoundingClientRect().top ?? 0;
		const add = el.querySelector('[data-testid="cal-add"]')?.getBoundingClientRect().top ?? 0;
		return card < add;
	});
	expect(order).toBe(true);
	// The details inside the sheet never scroll on their own: the sheet's content area is the one.
	const own = await sheet.evaluate((el) => {
		const d = el.querySelector<HTMLElement>('[data-testid="cal-details"]');
		return d ? getComputedStyle(d).overflowY : '';
	});
	expect(own).toBe('visible');
	const areas = await sheet.evaluate(
		(el) =>
			[...el.querySelectorAll<HTMLElement>('*')].filter((e) => {
				const o = getComputedStyle(e).overflowY;
				return o === 'auto' || o === 'scroll';
			}).length,
	);
	expect(areas, 'one scroll area in the sheet').toBe(1);
	await sheet.getByTestId('cal-clear').scrollIntoViewIfNeeded();
	await expect(sheet.getByTestId('cal-clear')).toBeInViewport();
});

test('the month scrolls only as far as it must, and stays put when the day is clear', async ({
	page,
}, info) => {
	await openCalendar(page, info);
	// The fourth week would be under the half sheet: the month scrolls, and the day ends above it.
	await openDetails(page, info, '2026-11-26');
	await settle(page);
	const moved = await scrollTop(page);
	expect(moved).toBeGreaterThan(0);
	let e = await edges(page, '2026-11-26');
	expect(e.dayBottom, 'the selected day is above the sheet').toBeLessThanOrEqual(e.sheetTop + 1);
	expect(e.dayTop, 'and still on screen').toBeGreaterThan(0);
	// Another day tapped while it is open keeps the sheet; one already clear of it does not move the month.
	for (const [date, title] of [
		['2026-11-24', 'Tue, Nov 24, 2026'],
		['2026-11-18', 'Wed, Nov 18, 2026'],
	] as const) {
		await day(page, date).tap();
		await expect(page.getByRole('dialog', { name: title })).toBeVisible();
		await settle(page);
		expect(
			Math.abs((await scrollTop(page)) - moved),
			`the month stayed for ${date}`,
		).toBeLessThanOrEqual(2);
		e = await edges(page, date);
		expect(e.dayBottom).toBeLessThanOrEqual(e.sheetTop + 1);
	}
	await expect(page.locator(SHEET)).toHaveCount(1);
});

test('Escape and Close slide it away and the focus goes back to the day', async ({
	page,
}, info) => {
	await openCalendar(page, info);
	await openDetails(page, info, '2026-11-20');
	await settle(page);
	const sheet = page.locator(SHEET);
	await sheet.getByRole('button', { name: 'Close' }).tap();
	await expect(sheet).toHaveCount(0);
	await expect(day(page, '2026-11-20')).toBeFocused();
	await expect(day(page, '2026-11-20')).toHaveAttribute('aria-selected', 'true');

	// A keyboard opens it with Enter on the day (the focus goes in) and Escape closes it.
	await day(page, '2026-11-20').focus();
	await page.keyboard.press('Enter');
	await expect(sheet).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(() => !!document.activeElement?.closest('[data-testid="cal-details"]')),
		)
		.toBe(true);
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(day(page, '2026-11-20')).toBeFocused();
});

test('frames of the slide up and down (the pictures)', async ({ page }, info) => {
	test.skip(!process.env['SCREENSHOTS'], 'pictures only');
	await page.emulateMedia({ colorScheme: 'dark' });
	await openCalendar(page, info);
	const d = await showDay(page, '2026-11-20');
	await tapDay(page, info, d);
	// Slow, so that a screenshot can catch a frame: the sheet reads its motion tokens at the start.
	await page.evaluate(() => document.documentElement.style.setProperty('--sheet-ms', '1600'));
	await page.evaluate(() => document.documentElement.style.setProperty('--sheet-out-ms', '1600'));
	await tapDay(page, info, d);
	await page.waitForSelector(SHEET);
	for (const [i, ms] of [60, 250, 500].entries()) {
		await page.waitForTimeout(ms);
		await shot(page, `up-${i + 1}`, info);
	}
	await page.waitForTimeout(1500);
	await page.locator(SHEET).getByRole('button', { name: 'Close' }).tap();
	for (const [i, ms] of [100, 400, 600].entries()) {
		await page.waitForTimeout(ms);
		await shot(page, `down-${i + 1}`, info);
	}
});

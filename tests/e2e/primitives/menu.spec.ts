// SPDX-License-Identifier: GPL-2.0-or-later
// The Menu primitive's contract (ADR-0016 #3; src/components/ui/Menu.svelte), on /dev/primitives
// without the engine, on desktop, Pixel 7 and iPhone 14:
// - the button opens it and says so (aria-expanded), the first item takes the focus;
// - Up and Down move through the items and wrap, Home and End go to the ends, and a disabled item is
//   skipped;
// - Escape closes it and gives the focus back to the button; Tab closes it; a press outside closes it;
// - choosing an item reports it, closes the menu and gives the focus back;
// - it stays on screen at 360 px wide (the end-aligned button at the right edge, the one low on the
//   screen opens above it);
// - items are 44 px high on a finger, and the key hints show only where a fine pointer is about;
// - on a finger the sheet mode opens a bottom Sheet whose items are 44 px high, and the action runs
//   once the sheet has gone.
// Consumers whose specs run on every change here: gantt-add-task, gantt-structure, gantt-a11y,
// gantt-name-id, gantt-manipulation, gantt-people-picker, gantt-gestures-edge, add-task-screenshots,
// phone-bugfixes, people-shell, new-plan, resources.
import { expect, test, type Page } from '@playwright/test';
import { isTouch } from '../lib/gantt-rig';
import {
	activeName,
	box,
	expectInside,
	hasFinePointer,
	openPrimitives,
	viewport,
} from '../lib/primitives-rig';

/** The popover list that is open (the page holds four menus; one is open at a time). */
const menu = (page: Page) => page.locator('ul.pop[role="menu"]');

async function open(page: Page, testid: string): Promise<void> {
	const button = page.getByTestId(testid);
	// Centred: the mock tab bar is fixed at the foot of the screen and would cover a button there.
	await button.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	// A scroll event arrives a frame after the scroll, and a scroll that is not the menu's own closes it.
	await page.evaluate(
		() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	);
	await button.click();
	await expect(button).toHaveAttribute('aria-expanded', 'true');
}

test.beforeEach(async ({ page }) => {
	await openPrimitives(page);
});

test('the button opens it and the first item has the focus', async ({ page }) => {
	await open(page, 'menu-start');
	await expect(menu(page)).toBeVisible();
	await expect(page.getByRole('menuitem', { name: /^Rename/ })).toBeFocused();
	await expect(page.getByTestId('menu-start')).toHaveAttribute('aria-haspopup', 'menu');
});

test('arrows move and wrap, Home and End go to the ends, a disabled item is skipped', async ({
	page,
}) => {
	await open(page, 'menu-start');
	const item = (name: RegExp) => page.getByRole('menuitem', { name });
	await page.keyboard.press('ArrowDown');
	await expect(item(/^Move up/)).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(item(/^Delete/)).toBeFocused(); // "Not now" is disabled
	await page.keyboard.press('ArrowDown');
	await expect(item(/^Rename/)).toBeFocused(); // wraps
	await page.keyboard.press('ArrowUp');
	await expect(item(/^Delete/)).toBeFocused();
	await page.keyboard.press('Home');
	await expect(item(/^Rename/)).toBeFocused();
	await page.keyboard.press('End');
	await expect(item(/^Delete/)).toBeFocused();
});

test('Escape closes it and the focus goes back to the button', async ({ page }) => {
	await open(page, 'menu-start');
	await page.keyboard.press('Escape');
	await expect(menu(page)).toHaveCount(0);
	await expect(page.getByTestId('menu-start')).toBeFocused();
	await expect(page.getByTestId('menu-start')).toHaveAttribute('aria-expanded', 'false');
});

test('Tab closes it', async ({ page }) => {
	await open(page, 'menu-start');
	await page.keyboard.press('Tab');
	await expect(menu(page)).toHaveCount(0);
});

test('a press outside closes it', async ({ page }) => {
	await open(page, 'menu-start');
	await page.getByRole('heading', { name: 'Select', exact: true }).click();
	await expect(menu(page)).toHaveCount(0);
});

test('choosing reports the item, closes the menu and gives the focus back', async ({ page }) => {
	await open(page, 'menu-start');
	await page.getByRole('menuitem', { name: /^Move up/ }).click();
	await expect(page.getByTestId('menu-chosen')).toHaveText('up');
	await expect(menu(page)).toHaveCount(0);
	await expect(page.getByTestId('menu-start')).toBeFocused();
});

test('a disabled item cannot be chosen', async ({ page }) => {
	await open(page, 'menu-start');
	await expect(page.getByRole('menuitem', { name: 'Not now' })).toBeDisabled();
});

test('the button toggles it', async ({ page }) => {
	await open(page, 'menu-start');
	await page.getByTestId('menu-start').click();
	await expect(menu(page)).toHaveCount(0);
});

test('stays on screen at 360 px: the button at the right edge, and the one low on the screen', async ({
	page,
}) => {
	await page.setViewportSize({ width: 360, height: 640 });
	await page.waitForTimeout(100);
	for (const id of ['menu-start', 'menu-end', 'menu-low']) {
		await open(page, id);
		const vp = await viewport(page);
		expectInside(await box(menu(page)), vp, id);
		await page.keyboard.press('Escape');
		await expect(menu(page)).toHaveCount(0);
	}
});

test('opens above the button when there is no room below', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 420 });
	await page.getByTestId('menu-low').evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await page.waitForTimeout(100);
	const trigger = await box(page.getByTestId('menu-low'));
	await page.getByTestId('menu-low').click();
	const m = await box(menu(page));
	expectInside(m, await viewport(page), 'the low menu');
	// Either it fits below the button or it has opened above it; never over the button.
	expect(m.y + m.height <= trigger.y + 1 || m.y >= trigger.y + trigger.height - 1).toBe(true);
});

test('items are 44 px on a finger and the key hints show only with a fine pointer', async ({
	page,
}, info) => {
	await open(page, 'menu-start');
	const items = await page.getByRole('menuitem').all();
	expect(items.length).toBe(4);
	for (const it of items) {
		const b = await box(it);
		if (isTouch(info)) expect(b.height, 'item height on a finger').toBeGreaterThanOrEqual(43.5);
		else expect(b.height).toBeGreaterThanOrEqual(30);
	}
	const hint = page.getByRole('menuitem', { name: /^Rename/ }).locator('kbd');
	if (await hasFinePointer(page)) await expect(hint).toBeVisible();
	else await expect(hint).toBeHidden();
});

test('sheet mode: a finger gets a bottom sheet with 44 px items, a mouse gets the popover', async ({
	page,
}, info) => {
	const trigger = page.getByTestId('menu-sheet-trigger');
	await trigger.click();
	if (isTouch(info)) {
		const list = page.getByTestId('menu-sheet');
		await expect(list).toBeVisible();
		await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
		for (const it of await list.getByRole('menuitem').all()) {
			expect((await box(it)).height).toBeGreaterThanOrEqual(43.5);
		}
		// The action runs once the sheet has gone, not as the tap lands.
		await list.getByRole('menuitem', { name: /^Delete/ }).tap();
		await expect(page.getByTestId('menu-chosen')).toHaveText('delete');
		await expect(page.getByTestId('menu-sheet')).toHaveCount(0);
	} else {
		await expect(page.getByTestId('menu-sheet')).toHaveCount(0);
		await expect(page.getByRole('menu', { name: 'Action menu' })).toBeVisible();
		await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
	}
});

test('the focus does not move to the first item when the sheet opens with the keyboard path closed', async ({
	page,
}, info) => {
	test.skip(!isTouch(info), 'the sheet is a finger’s');
	await page.getByTestId('menu-sheet-trigger').tap();
	await expect(page.getByTestId('menu-sheet')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('menu-sheet')).toHaveCount(0);
	expect(await activeName(page)).toContain('menu-sheet-trigger');
});

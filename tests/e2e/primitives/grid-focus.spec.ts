// SPDX-License-Identifier: GPL-2.0-or-later
// The grid-focus primitive's contract (ADR-0016 #3; src/lib/ui/roving-grid.ts), on /dev/primitives
// without the engine, on desktop, Pixel 7 and iPhone 14. The demo grid is built the way the heatmap, the
// outline and the calendar use it:
// - exactly one cell is in the tab order (the roving tab stop), and it follows the focus;
// - the focus survives a rebuild that replaces every cell element, and a move of the window;
// - a focus the person moved elsewhere is not taken back, nor one dropped by a click on nothing.
// Consumers whose specs run on every change here: workload (the zoom keeps the focus), lanes,
// gantt-treegrid, gantt-a11y, calendar.
import { expect, test, type Page } from '@playwright/test';
import { openPrimitives } from '../lib/primitives-rig';
import { frames } from '../lib/settle';

const cell = (page: Page, r: number, c: number) =>
	page.locator(`[data-testid="roving-cell"][data-row="${r}"][data-col="${c}"]`);

test.beforeEach(async ({ page }) => {
	await openPrimitives(page);
});

test('one cell is in the tab order, and it follows the focus', async ({ page }) => {
	const stops = () => page.locator('[data-testid="roving-cell"][tabindex="0"]');
	await expect(stops()).toHaveCount(1);
	await expect(stops()).toHaveAttribute('data-row', '0');
	await cell(page, 2, 1).focus();
	await expect(stops()).toHaveCount(1);
	await expect(stops()).toHaveAttribute('data-row', '2');
	await expect(stops()).toHaveAttribute('data-col', '1');
});

test('the arrow keys move the focus from cell to cell', async ({ page }) => {
	await cell(page, 1, 1).focus();
	await page.keyboard.press('ArrowRight');
	await expect(cell(page, 1, 2)).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(cell(page, 2, 2)).toBeFocused();
});

test('the focus survives a rebuild that replaces every cell element', async ({ page }) => {
	await cell(page, 2, 2).focus();
	await page.evaluate(() => {
		(
			document.querySelector(
				'[data-testid="roving-cell"][data-row="2"][data-col="2"]',
			) as HTMLElement
		).dataset['old'] = 'yes';
	});
	// The button takes the focus when it is pressed; press it with the keyboard-free route: dispatch.
	await page.evaluate(() =>
		(document.querySelector('[data-testid="roving-rebuild"]') as HTMLElement).click(),
	);
	await expect(page.getByTestId('roving-grid')).toHaveAttribute('data-generation', '1');
	await expect(cell(page, 2, 2)).toBeFocused();
	expect(await cell(page, 2, 2).getAttribute('data-old')).toBeNull(); // a new element
});

test('the focus survives the window moving (a scroll)', async ({ page }) => {
	await cell(page, 1, 2).focus();
	await page.evaluate(() =>
		(document.querySelector('[data-testid="roving-scroll"]') as HTMLElement).click(),
	);
	await expect(cell(page, 1, 2)).toBeFocused();
	await expect(page.locator('[data-testid="roving-cell"][tabindex="0"]')).toHaveAttribute(
		'data-col',
		'2',
	);
});

test('a focus the person moved elsewhere is not taken back by a rebuild', async ({ page }) => {
	await cell(page, 2, 2).focus();
	await page.getByTestId('roving-away').focus();
	await page.evaluate(() =>
		(document.querySelector('[data-testid="roving-rebuild"]') as HTMLElement).click(),
	);
	await expect(page.getByTestId('roving-grid')).toHaveAttribute('data-generation', '1');
	await expect(page.getByTestId('roving-away')).toBeFocused();
});

test('a click on nothing is not undone by a rebuild', async ({ page }) => {
	await cell(page, 2, 2).focus();
	await page.evaluate(() => (document.activeElement as HTMLElement).blur());
	await expect(page.locator('body')).toBeFocused();
	// The grid's focusout handling has run (it may defer to a frame) before the rebuild.
	await frames(page, 3);
	await page.evaluate(() =>
		(document.querySelector('[data-testid="roving-rebuild"]') as HTMLElement).click(),
	);
	await expect(page.getByTestId('roving-grid')).toHaveAttribute('data-generation', '1');
	await expect(page.locator('body')).toBeFocused();
});

test('the tab stop goes to the first cell of the window when the focus cell has left it', async ({
	page,
}) => {
	await cell(page, 1, 0).focus();
	await page.getByTestId('roving-away').focus();
	await page.evaluate(() => {
		const b = document.querySelector('[data-testid="roving-scroll"]') as HTMLElement;
		b.click();
		b.click();
	});
	await expect(page.locator('[data-testid="roving-cell"][tabindex="0"]')).toHaveCount(1);
	await expect(page.locator('[data-testid="roving-cell"][tabindex="0"]')).toHaveAttribute(
		'data-col',
		'2',
	);
});

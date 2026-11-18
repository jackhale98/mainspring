// SPDX-License-Identifier: GPL-2.0-or-later
// The Sheet primitive's contract (ADR-0016 #3; src/components/Sheet.svelte), on /dev/primitives
// without the engine, on desktop, Pixel 7 and iPhone 14. Every test slows the slides (`slowSheets`,
// 2 s) so that the shape of the motion is seen on every browser (ADR-0016 section 1); the speed itself
// is the timing tier's (sheet-states, phone-bugfixes).
// - half and full heights, and the grabber (a press or Enter) toggles them;
// - motion: only `transform` moves, the edge travels in many steps and the right way, no gap opens
//   between a sheet that shrinks and the tab bar;
// - every way to close it: the button, Escape, the backdrop, a drag down, the owner's `open`; each tells
//   the owner, and the focus returns to the button that opened it;
// - no scroll on open (the dialog's own `overflow: auto` scrolled WebKit to the focused field while the
//   panel slid in: the docs sheet appeared part way up);
// - no gap above the tab bar: a non-modal sheet's bottom edge is the bar's top edge on a phone.
// Consumers whose specs run on every change here: sheet-states, phone-bugfixes, inspector,
// calendar-sheet, picker-phone, gantt-phone-polish, picker and docs sheets (shell).
import { expect, test, type Page } from '@playwright/test';
import { animationsDone, panelSettled } from '../lib/settle';
import { box, openPrimitives, viewport } from '../lib/primitives-rig';
import {
	nonDecreasing,
	nonIncreasing,
	record,
	recorded,
	slowSheets,
	steps,
	stopRecording,
} from '../lib/sheet-rig';

const MODAL = 'dialog[data-testid="sheet-modal"]';
const DETAILS = 'dialog[data-testid="sheet-details"]';
const PANEL = `${MODAL} .inner`;

/** The bottom edge a non-modal bottom sheet rests on: the tab bar's top on a phone, else the screen's. */
async function restingBottom(page: Page): Promise<number> {
	const vp = await viewport(page);
	if (vp.width > 599) return vp.height;
	return (await box(page.getByTestId('mock-tabbar'))).y;
}

async function closed(page: Page, sel: string): Promise<void> {
	await expect.poll(() => page.locator(sel).evaluate((d: HTMLDialogElement) => d.open)).toBe(false);
}

test.beforeEach(async ({ page }) => {
	await openPrimitives(page);
	await slowSheets(page);
});

test.describe('heights and the grabber', () => {
	test('half and full: the grabber, a press or Enter, toggles them', async ({ page }) => {
		await page.getByTestId('open-details').click();
		const dialog = page.locator(DETAILS);
		await expect(dialog).toHaveAttribute('data-detent', 'half');
		await panelSettled(dialog);
		const half = await box(dialog);
		const grab = dialog.getByRole('button', { name: /Details height/ });
		await grab.click();
		await expect(dialog).toHaveAttribute('data-detent', 'full');
		await panelSettled(dialog);
		const full = await box(dialog);
		expect(full.height).toBeGreaterThan(half.height + 40);
		const vp = await viewport(page);
		expect(full.y + full.height).toBeLessThanOrEqual(vp.height + 1);
		await grab.focus();
		await page.keyboard.press('Enter');
		await expect(dialog).toHaveAttribute('data-detent', 'half');
		await panelSettled(dialog);
		expect((await box(dialog)).height).toBeCloseTo(half.height, -1);
	});

	test('no gap above the tab bar: the bottom edge rests on it, at half and at full', async ({
		page,
	}) => {
		await page.getByTestId('open-details').click();
		const dialog = page.locator(DETAILS);
		await panelSettled(dialog);
		const want = await restingBottom(page);
		const at = async () => {
			const b = await box(dialog);
			return b.y + b.height;
		};
		expect(Math.abs((await at()) - want), 'half').toBeLessThanOrEqual(1.5);
		await dialog.getByRole('button', { name: /Details height/ }).click();
		await panelSettled(dialog);
		expect(Math.abs((await at()) - want), 'full').toBeLessThanOrEqual(1.5);
	});

	test('a sheet that shrinks keeps its bottom edge: no gap opens under it', async ({ page }) => {
		await page.getByTestId('open-details').click();
		const dialog = page.locator(DETAILS);
		await panelSettled(dialog);
		const grab = dialog.getByRole('button', { name: /Details height/ });
		await grab.click();
		await panelSettled(dialog);
		const want = await restingBottom(page);
		await record(page, DETAILS);
		await grab.click();
		await animationsDone(page);
		const rec = await recorded(page);
		await stopRecording(page);
		// The bottom edge may go below its place while the top comes down, never above it.
		expect(Math.min(...rec.bottoms)).toBeGreaterThanOrEqual(want - 1.5);
	});
});

test.describe('motion', () => {
	test('sliding in: only transform moves, in many steps, upwards; no scroll on open', async ({
		page,
	}) => {
		// A sampler for the scroll: the dialog's own scroll position, in every frame.
		await page.evaluate((sel) => {
			const w = window as unknown as { __scroll: number };
			w.__scroll = 0;
			const tick = (): void => {
				const el = document.querySelector<HTMLElement>(sel);
				if (el) w.__scroll = Math.max(w.__scroll, el.scrollTop, el.scrollLeft);
				requestAnimationFrame(tick);
			};
			tick();
		}, MODAL);
		await record(page, PANEL);
		await page.getByTestId('open-modal').click();
		await expect(page.locator(MODAL)).toBeVisible();
		await animationsDone(page);
		const rec = await recorded(page);
		const tops = await stopRecording(page);
		const vp = await viewport(page);
		expect(
			rec.props.filter((p) => p !== 'transform'),
			'only transform animates',
		).toEqual([]);
		expect(steps(tops), 'the edge travels in many steps').toBeGreaterThan(4);
		expect(nonIncreasing(tops), 'upwards, never back').toBe(true);
		const last = tops[tops.length - 1] ?? 0;
		expect(rec.bottoms[rec.bottoms.length - 1], 'the panel ends at the foot').toBeLessThanOrEqual(
			vp.height + 1,
		);
		expect(last).toBeLessThan(vp.height);
		expect(
			await page.evaluate(() => (window as unknown as { __scroll: number }).__scroll),
			'the dialog never scrolled',
		).toBe(0);
		// The field that takes the focus is on screen where the panel came to rest.
		const field = await box(page.locator(MODAL).getByLabel('A field'));
		expect(field.y + field.height).toBeLessThanOrEqual(vp.height + 1);
		expect(field.y).toBeGreaterThanOrEqual(0);
	});

	test('sliding away: only transform moves, in many steps, downwards', async ({ page }) => {
		await page.getByTestId('open-modal').click();
		await panelSettled(page.locator(PANEL));
		await record(page, PANEL);
		await page.keyboard.press('Escape');
		// Marked as closing while the dialog is still open: the panel is still on screen, sliding.
		await expect(page.locator(MODAL)).toHaveAttribute('data-closing', '');
		await animationsDone(page);
		const rec = await recorded(page);
		const tops = await stopRecording(page);
		expect(rec.props.filter((p) => p !== 'transform')).toEqual([]);
		expect(steps(tops)).toBeGreaterThan(4);
		expect(nonDecreasing(tops), 'downwards, never back').toBe(true);
	});

	test('a non-modal sheet slides away on its own box, marked as closing while it is still open', async ({
		page,
	}) => {
		await page.getByTestId('open-details').click();
		await panelSettled(page.locator(DETAILS));
		await page.locator(DETAILS).getByLabel('A field').focus();
		await record(page, DETAILS);
		await page.keyboard.press('Escape');
		await expect(page.locator(DETAILS)).toHaveAttribute('data-closing', '');
		await animationsDone(page);
		const rec = await recorded(page);
		const tops = await stopRecording(page);
		expect(rec.props.filter((p) => p !== 'transform')).toEqual([]);
		expect(rec.closing, 'it was marked as closing while still open').toBe(true);
		expect(steps(tops)).toBeGreaterThan(4);
		expect(nonDecreasing(tops), 'downwards, never back').toBe(true);
	});
});

test.describe('every way to close it', () => {
	test('the Close button', async ({ page }) => {
		await page.getByTestId('open-modal').click();
		const dialog = page.locator(MODAL);
		await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
		await dialog.getByRole('button', { name: 'Close' }).click();
		await closed(page, MODAL);
		await expect(page.getByTestId('sheet-closed-by')).toHaveText('modal');
		await expect(page.getByTestId('open-modal')).toBeFocused();
		await expect(page.getByTestId('sheet-left')).toHaveText('1');
	});

	test('Escape', async ({ page }) => {
		await page.getByTestId('open-modal').click();
		await panelSettled(page.locator(PANEL));
		await page.keyboard.press('Escape');
		await closed(page, MODAL);
		await expect(page.getByTestId('sheet-closed-by')).toHaveText('modal');
		await expect(page.getByTestId('open-modal')).toBeFocused();
	});

	test('a press on the backdrop (the empty part above the panel)', async ({ page }) => {
		await page.getByTestId('open-modal').click();
		await panelSettled(page.locator(PANEL));
		// The dialog fills the screen and the panel is pinned to its foot: the top is the backdrop.
		await page.mouse.click(6, 6);
		await closed(page, MODAL);
		await expect(page.getByTestId('sheet-closed-by')).toHaveText('modal');
		await expect(page.getByTestId('open-modal')).toBeFocused();
	});

	test('a drag down on the grabber from half height', async ({ page }) => {
		await page.getByTestId('open-details').click();
		const dialog = page.locator(DETAILS);
		await panelSettled(dialog);
		const grab = await box(dialog.getByRole('button', { name: /Details height/ }));
		const x = grab.x + grab.width / 2;
		const y = grab.y + grab.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		for (let i = 1; i <= 12; i++) await page.mouse.move(x, y + i * 40);
		await page.mouse.up();
		await closed(page, DETAILS);
		await expect(page.getByTestId('sheet-closed-by')).toHaveText('details');
	});

	test('the owner’s `open` prop (a tab change): it slides away and the owner is told when it has closed', async ({
		page,
	}) => {
		await page.getByTestId('open-modal').click();
		await panelSettled(page.locator(PANEL));
		await page.evaluate(() =>
			(window as unknown as { __primitives: { closeAll(): void } }).__primitives.closeAll(),
		);
		await expect(page.locator(MODAL)).toHaveAttribute('data-closing', '');
		await closed(page, MODAL);
		await expect(page.getByTestId('sheet-left')).toHaveText('1');
	});

	test('a non-modal sheet: Escape closes it and the focus returns to what opened it', async ({
		page,
	}) => {
		await page.getByTestId('open-details').click();
		await panelSettled(page.locator(DETAILS));
		await page.locator(DETAILS).getByLabel('A field').focus();
		await page.keyboard.press('Escape');
		await closed(page, DETAILS);
		await expect(page.getByTestId('sheet-closed-by')).toHaveText('details');
		await expect(page.getByTestId('open-details')).toBeFocused();
	});

	test('the drawer (from the start edge): Escape closes it and the focus returns', async ({
		page,
	}) => {
		await page.getByTestId('open-drawer').click();
		const dialog = page.locator('dialog[data-testid="sheet-drawer"]');
		await panelSettled(dialog);
		await page.keyboard.press('Escape');
		await closed(page, 'dialog[data-testid="sheet-drawer"]');
		await expect(page.getByTestId('open-drawer')).toBeFocused();
	});
});

test('a sheet that opens while a touch keyboard is up does not leave a field half on screen', async ({
	page,
}) => {
	// The field of the modal sheet takes the focus as it opens; nothing of the panel is above the screen.
	await page.getByTestId('open-modal').click();
	await panelSettled(page.locator(PANEL));
	const vp = await viewport(page);
	const panel = await box(page.locator(PANEL));
	expect(panel.y).toBeGreaterThanOrEqual(0);
	expect(panel.y + panel.height).toBeLessThanOrEqual(vp.height + 1);
	await expect(page.locator(MODAL).getByLabel('A field')).toBeVisible();
});

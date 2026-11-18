// SPDX-License-Identifier: GPL-2.0-or-later
// The Popover primitive's contract (ADR-0016 #3; src/components/ui/Popover.svelte), on /dev/primitives
// without the engine, on desktop, Pixel 7 and iPhone 14:
// - the centred card opens from its button, is fully on screen and never taller or wider than the
//   screen, also at 360 px;
// - the anchored card opens beside its button and stays inside the viewport at 360 px, flipped above a
//   button that has no room below it;
// - Escape closes it and the focus returns to the button (WebKit does not focus a pressed button, so
//   the browser's own return has nowhere to go), a press outside closes it, the button toggles it;
// - `aria-expanded` follows the card; Escape does not reach what is under it;
// - on a phone the `foot` panel ends above the tab bar and stays on screen; axe finds nothing.
// Consumers whose specs run on every change here: shell, phone-status, update-check (the engine
// details and the plan status), workload (the thresholds).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { box, expectInside, openPrimitives, viewport } from '../lib/primitives-rig';

test.beforeEach(async ({ page }) => {
	await openPrimitives(page);
});

test('the centred card opens from its button, on screen, and closes with Escape; the focus returns', async ({
	page,
}) => {
	const trigger = page.getByTestId('pop-center-button');
	await trigger.click();
	const card = page.getByTestId('pop-center');
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: 'A button inside' }).focus();
	expectInside(await box(card), await viewport(page), 'the centred card');
	await page.keyboard.press('Escape');
	await expect(card).toBeHidden();
	await expect(trigger).toBeFocused();
});

test('the centred card never exceeds the screen at 360 px', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 480 });
	await page.getByTestId('pop-center-button').click();
	const b = await box(page.getByTestId('pop-center'));
	expectInside(b, await viewport(page), 'the centred card');
	expect(b.width).toBeLessThanOrEqual(360 - 32 + 1);
});

test('a press outside closes it', async ({ page }) => {
	await page.getByTestId('pop-center-button').click();
	await expect(page.getByTestId('pop-center')).toBeVisible();
	await page.mouse.click(2, 2);
	await expect(page.getByTestId('pop-center')).toBeHidden();
});

test('the anchored card opens beside its button and aria-expanded follows it', async ({ page }) => {
	const trigger = page.getByTestId('pop-anchor-button');
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await trigger.click();
	const card = page.getByTestId('pop-anchor');
	await expect(card).toBeVisible();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	await expect
		.poll(async () => await card.evaluate((el) => getComputedStyle(el).opacity))
		.toBe('1');
	const t = await box(trigger);
	const c = await box(card);
	expectInside(c, await viewport(page), 'the anchored card');
	// Beside the button: below it or above it, lined up with its end.
	expect(c.y >= t.y + t.height - 1 || c.y + c.height <= t.y + 1).toBe(true);
	expect(Math.abs(c.x + c.width - (t.x + t.width))).toBeLessThanOrEqual(2);
});

test('the anchored card stays inside the viewport at 360 px, and above a button with no room below', async ({
	page,
}) => {
	await page.setViewportSize({ width: 360, height: 640 });
	await page.getByTestId('pop-anchor-button').click();
	expectInside(await box(page.getByTestId('pop-anchor')), await viewport(page), 'at 360 px');
	await page.keyboard.press('Escape');
	// Little height: the card is above the button, or scrolls inside the room that there is.
	await page.setViewportSize({ width: 360, height: 300 });
	await page.getByTestId('pop-anchor-button').scrollIntoViewIfNeeded();
	await page.getByTestId('pop-anchor-button').click();
	expectInside(
		await box(page.getByTestId('pop-anchor')),
		await viewport(page),
		'in 300 px of height',
	);
});

test('Escape closes the anchored card and the focus returns to the button', async ({ page }) => {
	const trigger = page.getByTestId('pop-anchor-button');
	await trigger.click();
	const card = page.getByTestId('pop-anchor');
	await expect(card).toBeVisible();
	await card.getByLabel('A field').focus();
	await page.keyboard.press('Escape');
	await expect(card).toBeHidden();
	await expect(trigger).toBeFocused();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('the button toggles the card (a press on it is not a press outside)', async ({ page }) => {
	const trigger = page.getByTestId('pop-anchor-button');
	await trigger.click();
	await expect(page.getByTestId('pop-anchor')).toBeVisible();
	await trigger.click();
	await expect(page.getByTestId('pop-anchor')).toBeHidden();
});

test('Escape does not reach what is under the card (the Gantt’s own Escape)', async ({ page }) => {
	await page.evaluate(() => {
		(window as unknown as { __escapes: number }).__escapes = 0;
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') (window as unknown as { __escapes: number }).__escapes++;
		});
	});
	await page.getByTestId('pop-anchor-button').click();
	const card = page.getByTestId('pop-anchor');
	await card.getByLabel('A field').focus();
	await page.keyboard.press('Escape');
	await expect(card).toBeHidden();
	expect(await page.evaluate(() => (window as unknown as { __escapes: number }).__escapes)).toBe(0);
});

test('on a phone the foot panel clears the tab bar and stays on screen', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 640 });
	await page
		.getByTestId('pop-foot-button')
		.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await page.getByTestId('pop-foot-button').click();
	const card = page.getByTestId('pop-foot');
	await expect(card).toBeVisible();
	await expect.poll(async () => card.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
	const c = await box(card);
	const bar = await box(page.getByTestId('mock-tabbar'));
	expectInside(c, await viewport(page), 'the foot panel');
	expect(c.y + c.height, 'the panel ends above the tab bar').toBeLessThanOrEqual(bar.y + 1);
	expect(c.width, 'it spans the screen less its margins').toBeGreaterThan(360 - 24);
});

test('has no axe violations, centred or anchored, and is a named group', async ({ page }) => {
	await page.getByTestId('pop-anchor-button').click();
	await expect(page.getByRole('group', { name: 'Anchored card' })).toBeVisible();
	await expect
		.poll(async () => page.getByTestId('pop-anchor').evaluate((el) => getComputedStyle(el).opacity))
		.toBe('1');
	const run = async (what: string): Promise<void> => {
		const r = await new AxeBuilder({ page })
			.include('[popover]:popover-open')
			.withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
			.analyze();
		expect(
			r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
			what,
		).toEqual([]);
	};
	await run('anchored');
	await page.keyboard.press('Escape');
	await page.getByTestId('pop-center-button').click();
	await expect(page.getByTestId('pop-center')).toBeVisible();
	await run('centred');
});

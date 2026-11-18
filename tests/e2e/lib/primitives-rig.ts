// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The rig of the primitives' contract specs (tests/e2e/primitives/*.spec.ts; ADR-0016 #3): they open
 * the dev page /dev/primitives, which mounts each shared UI primitive with fake data and never boots
 * the engine, so each takes seconds on desktop, Pixel 7 and iPhone 14. The page is built only with the
 * dev pages (MAINSPRING_DEV_PAGES=1, which CI's e2e build sets).
 */
import { expect, type Locator, type Page } from '@playwright/test';

export const PRIMITIVES = '/dev/primitives';

export async function openPrimitives(
	page: Page,
	scheme: 'light' | 'dark' = 'light',
): Promise<void> {
	await page.emulateMedia({ colorScheme: scheme });
	await page.goto(PRIMITIVES);
	await expect(page.getByTestId('prim-sheet')).toBeVisible();
	// The page script has run (the width hook is how a spec sets a toolbar's container).
	await page.waitForFunction(() => '__primitives' in window);
}

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export async function box(loc: Locator): Promise<Box> {
	const b = await loc.boundingBox();
	if (!b) throw new Error('not on screen');
	return b;
}

/** The visual viewport's size: what "on screen" means for a floating panel. */
export const viewport = (page: Page): Promise<{ width: number; height: number }> =>
	page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));

/** A box is inside the viewport, within a pixel. */
export function expectInside(b: Box, vp: { width: number; height: number }, what: string): void {
	expect(b.x, `${what}: left edge`).toBeGreaterThanOrEqual(-1);
	expect(b.y, `${what}: top edge`).toBeGreaterThanOrEqual(-1);
	expect(b.x + b.width, `${what}: right edge`).toBeLessThanOrEqual(vp.width + 1);
	expect(b.y + b.height, `${what}: bottom edge`).toBeLessThanOrEqual(vp.height + 1);
}

/** Whether a fine pointer is about on this device (a mouse: yes; a phone: no). */
export const hasFinePointer = (page: Page): Promise<boolean> =>
	page.evaluate(() => matchMedia('(any-pointer: fine)').matches);

/** Whether the primary pointer is a finger. */
export const isCoarse = (page: Page): Promise<boolean> =>
	page.evaluate(() => matchMedia('(pointer: coarse)').matches);

/** Moves the focus without a pointer, as a keyboard user's Tab does: focus then check. */
export const activeName = (page: Page): Promise<string> =>
	page.evaluate(() => {
		const el = document.activeElement;
		return el
			? `${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') ?? el.getAttribute('role') ?? el.textContent?.trim().slice(0, 20) ?? ''}]`
			: 'none';
	});

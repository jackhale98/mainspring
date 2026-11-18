// SPDX-License-Identifier: GPL-2.0-or-later
/** A state of the app that holds a health finding with a select, for select-arrows.spec.ts. */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { openHealth, openPlan, rowOf } from './health-rig';

export const LICENSE_TASK = 'f20.supplement_wallpaper.supplement_license_review';

/** Opens `fedora-res`, its health panel, and the finding "work without people" of the license review. */
export async function openHealthPanel(page: Page, info: TestInfo): Promise<Locator> {
	await openPlan(page, info);
	const panel = await openHealth(page, info);
	// The list is windowed and a row can unmount while it is scrolled to (WebKit does it more): try again.
	let last: unknown;
	for (let i = 0; i < 4; i++) {
		try {
			const row = await rowOf(panel, 'work-without-people', LICENSE_TASK);
			await expect(row).toHaveCount(1);
			return row;
		} catch (e) {
			last = e;
			await page.waitForTimeout(300);
		}
	}
	throw last;
}

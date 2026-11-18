// SPDX-License-Identifier: GPL-2.0-or-later
/** States of the app that hold a health finding, for select-arrows.spec.ts and picker-phone.spec.ts. */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { openHealth, openPlan, rowOf } from './health-rig';

export const LICENSE_TASK = 'f20.supplement_wallpaper.supplement_license_review';
export const WIKI_TASK = 'f20.PlanningPhase.clean_market_wiki';

/** Opens `fedora-res`, its health panel, and the row of a check's finding for a task. */
export async function openHealthRow(
	page: Page,
	info: TestInfo,
	check: Parameters<typeof rowOf>[1],
	task: string,
): Promise<Locator> {
	await openPlan(page, info);
	const panel = await openHealth(page, info);
	// The list is windowed and a row can unmount while it is scrolled to (WebKit does it more): try again.
	let last: unknown;
	for (let i = 0; i < 4; i++) {
		try {
			const row = await rowOf(panel, check, task);
			await expect(row).toHaveCount(1);
			return row;
		} catch (e) {
			last = e;
			await page.waitForTimeout(300);
		}
	}
	throw last;
}

/** The finding "work without people" of the license review. */
export const openHealthPanel = (page: Page, info: TestInfo): Promise<Locator> =>
	openHealthRow(page, info, 'work-without-people', LICENSE_TASK);

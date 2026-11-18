// SPDX-License-Identifier: GPL-2.0-or-later
/** States of the app that hold a health finding, for select-arrows.spec.ts and picker-phone.spec.ts. */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { Rig } from './gantt-rig';
import { frames } from './settle';
import { openHealth, openPlan, rowOf } from './health-rig';

export const LICENSE_TASK = 'f20.supplement_wallpaper.supplement_license_review';
export const WIKI_TASK = 'f20.PlanningPhase.clean_market_wiki';

/**
 * Opens a plan (`fedora-res` unless `plan` says otherwise), its health panel, and the row of a check's
 * finding for a task.
 */
export async function openHealthRow(
	page: Page,
	info: TestInfo,
	check: Parameters<typeof rowOf>[1],
	task: string,
	plan?: string,
): Promise<Locator> {
	if (plan === undefined) await openPlan(page, info);
	else await Rig.open(page, info, undefined, 'visual', plan);
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
			// The windowed list remounts its rows as it settles: draw frames, then look again.
			await frames(page, 12);
		}
	}
	throw last;
}

/** The finding "work without people" of the license review. */
export const openHealthPanel = (page: Page, info: TestInfo): Promise<Locator> =>
	openHealthRow(page, info, 'work-without-people', LICENSE_TASK);

/**
 * A finding with a "Replace with…" list on the small people plan (`ui-people`: Ben's API task is held
 * by people), for the specs that look at the pill and not at the plan's size (ADR-0016 #4).
 */
export const openSmallHealthPanel = (page: Page, info: TestInfo): Promise<Locator> =>
	openHealthRow(page, info, 'held-by-people', 'build.core.api', 'ui-people');

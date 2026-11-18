// SPDX-License-Identifier: GPL-2.0-or-later
// A desktop's Calendar in a pane narrower than 760 px (Split mode: the editor takes half of the
// width) keeps the day details in the view, a panel over the month's foot. It never opens the
// bottom Sheet (a phone's and a tablet's), which would cover the editor or the docked details
// beside it (review, 2026-11-17).
import { expect, test } from '@playwright/test';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { showDay, tapDay } from './lib/calendar-rig';

test.setTimeout(READY_TIMEOUT_MS * 2);

test('desktop: in a narrow pane the day details stay in the view, not in the bottom Sheet', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'the desktop layout');
	await page.setViewportSize({ width: 1024, height: 768 });
	await page.goto('/app?sample=poc-sample&mode=split&view=calendar&hooks=edits');
	await expect(page.getByTestId('cal-day').first()).toBeVisible({ timeout: 60_000 });
	const calendar = page.getByTestId('calendar');
	const width = (await calendar.boundingBox())?.width ?? 0;
	console.log('CALW', width);
	expect(width, 'the Calendar is in a pane narrower than 760 px').toBeLessThan(760);
	const d = await showDay(page, '2026-11-20');
	await tapDay(page, info, d);
	const details = page.getByTestId('cal-details');
	await expect(details).toBeVisible();
	// No Sheet: no open dialog, and the details are inside the Calendar's own box.
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	const inside = await page.evaluate(() => {
		const c = document.querySelector('[data-testid="calendar"]')?.getBoundingClientRect();
		const e = document.querySelector('[data-testid="cal-details"]')?.getBoundingClientRect();
		if (!c || !e) return false;
		return e.left >= c.left - 1 && e.right <= c.right + 1 && e.bottom <= c.bottom + 1;
	});
	expect(inside, 'the details are inside the Calendar').toBe(true);
	// The selected day is above the panel, and Escape closes it.
	const box = await d.boundingBox();
	const panel = await details.boundingBox();
	if (!box || !panel) throw new Error('no box');
	expect(box.y + box.height).toBeLessThanOrEqual(panel.y + 1);
	await page.keyboard.press('Escape');
	await expect(details).toBeHidden();
});

// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots of the Calendar (phase-3.md T16, 13.2, 22), on `poc-sample`: the desktop month, a
// person's painted leave with its details, the type picker, and the Pixel 7 month with the Paint
// bar, with a selection and with the details sheet, light and dark. Run with SCREENSHOTS=1; it
// writes docs/phases/screenshots/phase-3/t16-<what>-<device>-<light|dark>.png; the month that
// fills the desktop's view (1280x720, 1920x1080, the details docked, a crowded day) and the
// phone's month write calendar-month-<what>-<size or device>-<light|dark>.png.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, deviceName, isTouch } from './lib/gantt-rig';
import {
	SAM_DAY,
	SAM_TEXT,
	appendText,
	caughtUp,
	day,
	drag,
	openCalendar,
	openDetails,
	setMode,
	setScope,
	setType,
	showDay,
} from './lib/calendar-rig';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

test.describe('calendar screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS * 3);

	async function shoot(page: Page, device: string, what: string): Promise<void> {
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.waitForTimeout(500);
			await page.screenshot({ path: path.join(DIR, `t16-${what}-${device}-${scheme}.png`) });
		}
		await page.emulateMedia({ colorScheme: 'light' });
		await page.waitForTimeout(200);
	}

	test('the month list or month, a painted leave and its details, the type picker', async ({
		page,
	}, info) => {
		const device = deviceName(info);
		const touch = isTouch(info);
		await openCalendar(page, info);
		await showDay(page, '2026-11-26');
		await shoot(page, device, 'month-everyone');

		// A person's sick leave, painted; the details show its fields.
		await setScope(page, 'Jack');
		await setType(page, 'Sick leave');
		await setMode(page, 'paint');
		await showDay(page, '2026-12-14');
		if (!touch) {
			// Before the drop: the run being painted, still only a selection.
			await day(page, '2026-12-14').evaluate((el) => el.scrollIntoView({ block: 'center' }));
			await page.waitForTimeout(150);
			const a = await day(page, '2026-12-14').boundingBox();
			const b = await day(page, '2026-12-16').boundingBox();
			if (!a || !b) throw new Error('no days');
			await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
			await page.mouse.down();
			await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
			await expect(page.getByTestId('cal-line')).toContainText('Paint:');
			await shoot(page, device, 'paint-drag');
			await page.mouse.up();
		} else {
			await drag(page, info, day(page, '2026-12-14'), day(page, '2026-12-16'));
		}
		await expect(day(page, '2026-12-14')).toHaveAccessibleName(/Sick leave/);
		await caughtUp(page);
		await setMode(page, 'select');
		await openDetails(page, info, '2026-12-14');
		await page.waitForTimeout(400);
		await shoot(page, device, 'details');

		if (!touch) {
			// The keyboard path: select, press L, the type picker.
			await page.getByRole('button', { name: 'Close' }).click();
			const d = await showDay(page, '2026-12-21');
			await d.focus();
			await page.keyboard.press('Shift+ArrowRight');
			await page.keyboard.press('Shift+ArrowRight');
			await page.keyboard.press('l');
			await expect(page.getByTestId('cal-picker')).toBeVisible();
			await shoot(page, device, 'type-picker');
		}
	});

	// The month that fills the view (22.x, amended 2026-11-17): writes calendar-month-<what>-<size>-<scheme>.png.
	async function shootMonth(page: Page, what: string, size: string): Promise<void> {
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.waitForTimeout(500);
			await page.screenshot({
				path: path.join(DIR, `calendar-month-${what}-${size}-${scheme}.png`),
			});
		}
		await page.emulateMedia({ colorScheme: 'light' });
		await page.waitForTimeout(200);
	}

	for (const [w, h] of [
		[1280, 720],
		[1920, 1080],
	] as const) {
		test(`the month that fills the view at ${w}x${h}, with the details docked`, async ({
			page,
		}, info) => {
			test.skip(isTouch(info), 'a desktop');
			await page.setViewportSize({ width: w, height: h });
			await openCalendar(page, info, { mode: 'text' });
			await appendText(page, info, SAM_TEXT);
			await setScope(page, 'Sam');
			await showDay(page, '2026-11-26');
			await shootMonth(page, 'november', `${w}x${h}`);
			// A day with several leaves: "+N more" where they do not fit; its details docked.
			await showDay(page, SAM_DAY);
			await page.waitForTimeout(150);
			await shootMonth(page, 'december-leaves', `${w}x${h}`);
			const crowd = day(page, SAM_DAY);
			await crowd.click();
			await expect(page.getByTestId('cal-details')).toBeVisible();
			await page.waitForTimeout(450);
			await shootMonth(page, 'details-docked', `${w}x${h}`);
		});
	}

	test('the phone month, unchanged', async ({ page }, info) => {
		test.skip(!isTouch(info), 'a phone');
		await openCalendar(page, info);
		await showDay(page, '2026-11-26');
		await shootMonth(page, 'month', deviceName(info));
		await openDetails(page, info, '2026-11-26');
		await page.waitForTimeout(500);
		await shootMonth(page, 'details', deviceName(info));
	});
});

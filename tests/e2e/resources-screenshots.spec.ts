// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots of the resource table, groups and person details (phase-3.md 13.2; CLAUDE.md "mobile
// counts"): desktop and Pixel 7 emulation, light and dark, to docs/phases/screenshots/phase-3/t17-*.png:
// - the Resources view (the table beside the lanes; the phone's Team segment) with a person selected
//   and their details open (the right panel; the bottom sheet after the second tap);
// - the working-hours editor and the leaves of a person;
// - Add person's name field, a row lifted mid-drag with its drop line, and the not-a-group refusal;
// - the project sheet with its working hours, working day, week start, time format and currency.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { READY_TIMEOUT_MS, deviceName, isTouch } from './lib/gantt-rig';
import { caughtUp, openPerson, openResources, row, selectRow } from './lib/resources-rig';
import { pictureReady } from './lib/settle';

const DIR = path.join(process.cwd(), 'docs/phases/screenshots/phase-3');

test.setTimeout(READY_TIMEOUT_MS * 2);

for (const scheme of ['light', 'dark'] as const) {
	test(`resource table and person details screenshots (${scheme})`, async ({ page }, info) => {
		fs.mkdirSync(DIR, { recursive: true });
		const device = deviceName(info);
		const shot = async (name: string): Promise<void> => {
			await pictureReady(page);
			await page.screenshot({ path: path.join(DIR, `t17-${name}-${device}-${scheme}.png`) });
		};
		await openResources(page, info, { scheme });

		// The table with nobody selected, then a person's details.
		await shot('table');
		const d = await openPerson(page, info, 'ana');
		await expect(d).toBeVisible();
		await shot('person-details');
		// The working-hours editor and the leaves, scrolled into view.
		await d.getByTestId('working-hours').scrollIntoViewIfNeeded();
		await d.getByTestId('working-hours').getByLabel('Saturday: day off').uncheck();
		await caughtUp(page);
		await shot('person-hours');
		await d.getByTestId('person-leaves').scrollIntoViewIfNeeded();
		await shot('person-leaves');

		// Add person: the name first.
		if (isTouch(info)) await page.keyboard.press('Escape');
		await page.getByTestId('add-person-row').click();
		await page.getByTestId('add-form').getByRole('textbox').fill('Cy Twombly');
		await shot('add-person');
		await page.getByTestId('add-form').getByRole('textbox').press('Escape');

		// The refusal: Tess is last, and the person above her has tasks.
		await page.getByTestId('add-person-row').click();
		await page.getByTestId('add-form').getByRole('textbox').fill('Tess');
		await page.getByTestId('add-form').getByRole('textbox').press('Enter');
		await caughtUp(page);
		await row(page, 'tess').focus();
		await page.keyboard.press('Alt+Shift+ArrowRight');
		await expect(page.getByText(/so people cannot join it/).first()).toBeVisible({
			timeout: 20_000,
		});
		await shot('not-a-group');

		// A row lifted mid-drag, with its drop line (a mouse; the finger's long-press shows it too).
		if (!isTouch(info)) {
			await selectRow(page, info, 'rev');
			const grip = await row(page, 'rev').getByTestId('resource-grip').boundingBox();
			if (!grip) throw new Error('no grip');
			await page.mouse.move(grip.x + 12, grip.y + 20);
			await page.mouse.down();
			await page.mouse.move(grip.x + 12, grip.y - 10, { steps: 4 });
			await page.mouse.move(grip.x + 40, grip.y - 10, { steps: 4 });
			await shot('drag-row');
			await page.keyboard.press('Escape');
			await page.mouse.up();
		}
	});

	test(`project sheet with the rest of the frame (${scheme})`, async ({ page }, info) => {
		fs.mkdirSync(DIR, { recursive: true });
		const device = deviceName(info);
		await openResources(page, info, { scheme });
		await page.locator('header').getByRole('button', { name: 'Project settings' }).click();
		const sheet = page.getByRole('dialog', { name: 'Project' });
		await expect(sheet).toBeVisible();
		await sheet.getByTestId('working-hours').scrollIntoViewIfNeeded();
		await pictureReady(page);
		await page.screenshot({ path: path.join(DIR, `t17-project-sheet-${device}-${scheme}.png`) });
		await sheet.getByRole('switch', { name: 'Weeks start on Monday' }).scrollIntoViewIfNeeded();
		await pictureReady(page);
		await page.screenshot({
			path: path.join(DIR, `t17-project-sheet-frame-${device}-${scheme}.png`),
		});
	});
}

// SPDX-License-Identifier: GPL-2.0-or-later
// A new task's id follows its first name (polish item 15; ADR-0013 amendment, 2026-11-16), on
// desktop Chrome and the Pixel 7 emulation: + adds `task new_task "New task"`, typing "Write specs"
// in the details' name gives `task write_specs "Write specs"` in the text, the selection and the
// details follow the new id, History shows the rename as one step after the add (the phone's
// History sheet; Undo's and Redo's titles on the desktop), and one Undo puts back
// `new_task "New task"`. The poc sample has no macros, so nothing keeps the id. With
// SCREENSHOTS=1 the Pixel 7 run writes
// docs/phases/screenshots/phase-3/polish-15-id-follows-name-pixel-7-<light|dark>.png.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

test.describe('the id follows the first name', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7');
	});

	const nameField = (page: Page) => page.getByRole('textbox', { name: 'Name', exact: true });

	async function tap(rig: Rig, target: ReturnType<Page['getByTestId']>): Promise<void> {
		if (isTouch(rig.info)) await target.tap();
		else await target.click();
	}

	test('+ then "Write specs" writes task write_specs; History has one rename step; Undo restores new_task', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info, undefined, 'visual', 'poc-sample');
		const before = await rig.text();
		expect(before).not.toContain('new_task');

		await tap(rig, page.getByTestId('add-task'));
		await expect.poll(() => rig.text()).toContain('task new_task "New task"');
		const added = await rig.text();
		await expect(nameField(page)).toBeFocused({ timeout: READY_TIMEOUT_MS });
		await expect(rig.row('task:new_task')).toHaveAttribute('aria-selected', 'true');

		await page.keyboard.type('Write specs');
		await page.keyboard.press('Enter');
		const named = added.replace('task new_task "New task"', 'task write_specs "Write specs"');
		expect(named).not.toBe(added);
		await expect.poll(() => rig.text()).toBe(named);

		// The selection, the row and the details follow the new id.
		await expect(rig.row('task:write_specs')).toHaveAttribute('aria-selected', 'true', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(rig.row('task:new_task')).toHaveCount(0);
		await expect(rig.row('task:write_specs')).toBeInViewport();
		await expect(nameField(page)).toHaveValue('Write specs');
		// The details mount again for the new id; Enter left the focus in the name, and it stays there.
		await expect(nameField(page)).toBeFocused();
		const idLine = page.locator('.task p.id code');
		await expect(idLine).toHaveText('write_specs');
		if (isTouch(info)) {
			await expect(page.getByRole('dialog', { name: /Task details/ })).toBeVisible();
			if (process.env['SCREENSHOTS']) {
				await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
				await page.waitForTimeout(600);
				for (const scheme of ['light', 'dark'] as const) {
					await page.emulateMedia({ colorScheme: scheme });
					await page.waitForTimeout(400);
					await page.screenshot({
						path: path.join(DIR, `polish-15-id-follows-name-pixel-7-${scheme}.png`),
					});
				}
				await page.emulateMedia({ colorScheme: 'light' });
			}
		}

		// History: the rename is one step, right after the add. The phone has the History sheet (the
		// Undo button's context menu); the desktop names the steps in Undo's and Redo's titles.
		const undo = page.getByTestId('undo');
		const redo = page.getByTestId('redo');
		if (isTouch(info)) {
			await undo.focus();
			await page.keyboard.press('Shift+F10');
			const sheet = page.getByRole('dialog', { name: 'History' });
			await expect(sheet).toBeVisible();
			const entries = sheet.getByTestId('history-entry');
			await expect(entries.nth(0)).toContainText('Renamed New task to Write specs');
			await expect(entries.nth(1)).toContainText('Added New task');
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();
		} else {
			await expect(undo).toHaveAttribute('title', 'Undo: Renamed New task to Write specs');
		}

		// One Undo takes back the name and the id together; the selection follows back.
		await undo.click();
		await expect.poll(() => rig.text()).toBe(added);
		if (!isTouch(info)) {
			await expect(undo).toHaveAttribute('title', 'Undo: Added New task');
			await expect(redo).toHaveAttribute('title', 'Redo: Renamed New task to Write specs');
		}
		await expect(rig.row('task:new_task')).toHaveAttribute('aria-selected', 'true', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(idLine).toHaveText('new_task');
		await undo.click();
		await expect.poll(() => rig.text()).toBe(before);
	});
});

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
import { openHistoryFromUndo } from './lib/finger';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

test.describe('the id follows the first name', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);

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
		const gone = await watchGone(page);

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
		// The details stay mounted across the id change: Enter left the focus in the name, and it stays.
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
			await openHistoryFromUndo(page);
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
		// Neither the rename nor its undo showed the task as gone (the add's undo then removes it).
		expect(await gone()).toBe(false);
		await undo.click();
		await expect.poll(() => rig.text()).toBe(before);
	});
	/**
	 * Watches, from now on, for the details' "This task is no longer in the plan." (a
	 * MutationObserver and a check every animation frame); `seen()` says whether it ever showed.
	 */
	async function watchGone(page: Page): Promise<() => Promise<boolean>> {
		await page.evaluate(() => {
			const w = window as unknown as { __gone: boolean };
			w.__gone = false;
			const check = (): void => {
				if (document.body.innerText.includes('This task is no longer in the plan.'))
					w.__gone = true;
			};
			new MutationObserver(check).observe(document.body, {
				subtree: true,
				childList: true,
				characterData: true,
			});
			const frame = (): void => {
				check();
				requestAnimationFrame(frame);
			};
			requestAnimationFrame(frame);
		});
		return () => page.evaluate(() => (window as unknown as { __gone: boolean }).__gone);
	}

	/** Opens the poc sample and presses +: the new task's name is focused, ready to type. */
	async function addNew(page: Page, info: Parameters<typeof Rig.open>[1]): Promise<Rig> {
		const rig = await Rig.open(page, info, undefined, 'visual', 'poc-sample');
		const add = page.getByTestId('add-task');
		if (isTouch(info)) await add.tap();
		else await add.click();
		await expect.poll(() => rig.text()).toContain('task new_task "New task"');
		await expect(nameField(page)).toBeFocused({ timeout: READY_TIMEOUT_MS });
		return rig;
	}

	test('Tab after the name: the focus is on the next field (the kind of size), and stays there', async ({
		page,
	}, info) => {
		const rig = await addNew(page, info);
		const gone = await watchGone(page);
		await page.keyboard.type('Write specs');
		await page.keyboard.press('Tab');
		const kind = page.getByRole('combobox', { name: 'Kind of size', exact: true });
		await expect.poll(() => rig.text()).toContain('task write_specs "Write specs"');
		await expect(page.locator('.task p.id code')).toHaveText('write_specs');
		// The details never said the task was gone while the index caught up with the new id.
		expect(await gone()).toBe(false);
		await expect(kind).toBeFocused();
		// Long after the index has caught up, the focus is still on the same field.
		await page.waitForTimeout(3000);
		await expect(kind).toBeFocused();
		expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('SELECT');
	});

	test('keys typed right after Enter are kept, and the task is never shown as gone', async ({
		page,
	}, info) => {
		const rig = await addNew(page, info);
		const gone = await watchGone(page);
		await page.keyboard.type('Write specs');
		await page.keyboard.press('Enter');
		// No wait: these keys land while the index catches up with the new id.
		await page.keyboard.type(' v2');
		await page.keyboard.press('Enter');
		await expect.poll(() => rig.text()).toContain('task write_specs "Write specs v2"');
		await expect(nameField(page)).toHaveValue('Write specs v2');
		await expect(nameField(page)).toBeFocused();
		expect(await gone()).toBe(false);
		// Two renames, one id change: the second keeps the id (it is no longer automatic).
		expect(await rig.text()).not.toContain('write_specs_v2');
	});
});

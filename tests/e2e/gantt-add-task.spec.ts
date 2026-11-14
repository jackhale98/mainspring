// SPDX-License-Identifier: GPL-2.0-or-later
// The Add task (+) control (phase-3.md 9.8, T3; ADR-0013), on desktop Chrome (a mouse) and the
// Pixel 7 emulation (a finger): it adds after the selected task, at the end of the plan when
// nothing is selected, and a subtask of the selected task; the new task is selected, the details
// are open (the phone's sheet) with the name focused and selected; the text has the new task; the
// name typed is a second undo step. The control is a 44 px target on a coarse pointer and has an
// accessible name. The screenshots are add-task-screenshots.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';

test.describe('Add task (+)', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T3); iPhone is reported');
	});

	const add = (page: Page) => page.getByTestId('add-task');
	const nameField = (page: Page) => page.getByRole('textbox', { name: 'Name', exact: true });

	/** Selects a row by its label: a first tap on a phone only selects. */
	async function select(rig: Rig, key: string): Promise<void> {
		const label = rig.row(key).locator('.label');
		if (isTouch(rig.info)) await label.tap();
		else await label.click();
		await expect(rig.row(key)).toHaveAttribute('aria-selected', 'true');
	}

	/** Presses + and, when a task is selected, the menu item. */
	async function press(page: Page, rig: Rig, item?: 'Add task after' | 'Add subtask') {
		const touch = isTouch(rig.info);
		if (touch) await add(page).tap();
		else await add(page).click();
		if (item === undefined) return;
		const entry = page.getByRole('menuitem', { name: item });
		if (touch) await entry.tap();
		else await entry.click();
	}

	/** The details are open on the new task: its name is focused, and all of it is selected. */
	async function expectNameReady(page: Page, key: string): Promise<void> {
		await expect(nameField(page)).toBeFocused({ timeout: READY_TIMEOUT_MS });
		await expect(nameField(page)).toHaveValue('New task');
		const sel = await nameField(page).evaluate((el: HTMLInputElement) => [
			el.selectionStart,
			el.selectionEnd,
		]);
		expect(sel).toEqual([0, 'New task'.length]);
		await expect(page.locator(`[role="row"][data-key="${key}"]`)).toHaveAttribute(
			'aria-selected',
			'true',
		);
	}

	test('after the selected task: written after it, selected, details open, name focused; the name and the add are two undo steps', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await select(rig, 'task:launch');
		await press(page, rig, 'Add task after');
		const added = before.replace(
			'  responsible dev1\n}\n\n',
			'  responsible dev1\n}\n\ntask new_task "New task"\n\n',
		);
		expect(added).not.toBe(before);
		await expect.poll(() => rig.text()).toBe(added);
		await expectNameReady(page, 'task:new_task');
		if (isTouch(info)) {
			await expect(page.getByRole('dialog', { name: /Task details/ })).toBeVisible();
		}

		// The name is its own edit.
		await page.keyboard.type('Write the specs');
		await page.keyboard.press('Enter');
		const named = added.replace('"New task"', '"Write the specs"');
		await expect.poll(() => rig.text()).toBe(named);

		const undo = page.getByTestId('undo');
		await undo.click();
		await expect.poll(() => rig.text()).toBe(added);
		await undo.click();
		await expect.poll(() => rig.text()).toBe(before);
		await expect(rig.row('task:new_task')).toHaveCount(0);
	});

	test('nothing selected: a click adds at once, at the end of the plan', async ({ page }, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const tji = await rig.text('lib/build.tji');
		await expect(rig.row('task:launch')).not.toHaveAttribute('aria-selected', 'true');
		// No menu: with nothing selected the button adds straight away.
		await expect(add(page)).not.toHaveAttribute('aria-haspopup', 'menu');
		await press(page, rig);
		await expect(rig.row('task:new_task')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expectNameReady(page, 'task:new_task');
		// The new task is the last top-level row.
		const keys = await page
			.locator('[role="row"][data-key^="task:"]')
			.evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset['key'] ?? ''));
		expect(keys.at(-1)).toBe('task:new_task');
		const after = (await rig.text()) + (await rig.text('lib/build.tji'));
		expect(after).toContain('task new_task "New task"');
		expect(after.length).toBeGreaterThan((before + tji).length);

		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.getByTestId('undo').click();
		await expect
			.poll(async () => (await rig.text()) + (await rig.text('lib/build.tji')))
			.toBe(before + tji);
	});

	test('Add subtask: the new task is the last child of the selected one', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await select(rig, 'task:design');
		await press(page, rig, 'Add subtask');
		const added = before.replace(
			'    depends !docs\n  }\n}\n',
			'    depends !docs\n  }\n  task new_task "New task"\n}\n',
		);
		expect(added).not.toBe(before);
		await expect.poll(() => rig.text()).toBe(added);
		await expectNameReady(page, 'task:design.new_task');
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.getByTestId('undo').click();
		await expect.poll(() => rig.text()).toBe(before);
	});

	test('a refusal of the edit API applies unchanged: a subtask of a sized leaf is refused', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await select(rig, 'task:design.research');
		await press(page, rig, 'Add subtask');
		await expect(rig.edited.last()).toContainText('conflicts', { timeout: READY_TIMEOUT_MS });
		expect(await rig.text()).toBe(before);
		await expect(rig.row('task:design.research')).toHaveAttribute('aria-selected', 'true');
		// Nothing opened: no name field has the focus (a phone's sheet stays closed).
		expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
	});

	test('a double press adds one task, not two', async ({ page }, info) => {
		const rig = await Rig.open(page, info);
		await expect(add(page)).not.toHaveAttribute('aria-haspopup', 'menu');
		// Two clicks in the same task: the second finds the first add still under way.
		await add(page).evaluate((b: HTMLElement) => {
			b.click();
			b.click();
		});
		await expectNameReady(page, 'task:new_task');
		await page.waitForTimeout(1000);
		const text = (await rig.text()) + (await rig.text('lib/build.tji'));
		expect(text.match(/task new_task/g)).toHaveLength(1);
		await expect(rig.row('task:new_task2')).toHaveCount(0);
	});

	test('the control is named, reachable by keyboard, and 44 px on a coarse pointer', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		await expect(page.getByRole('button', { name: 'Add task' })).toBeVisible();
		if (isTouch(info)) {
			const box = await add(page).boundingBox();
			expect(box?.width).toBeGreaterThanOrEqual(44);
			expect(box?.height).toBeGreaterThanOrEqual(44);
		} else {
			// Keyboard: Tab reaches it, Enter adds, and the focus lands in the name field.
			await add(page).focus();
			await expect(add(page)).toBeFocused();
			await page.keyboard.press('Enter');
			await expectNameReady(page, 'task:new_task');
		}
		void rig;
	});

	test('with a task selected the menu is a menu: arrows move, Escape closes and returns to +', async ({
		page,
	}, info) => {
		test.skip(isTouch(info), 'keys');
		const rig = await Rig.open(page, info);
		await select(rig, 'task:launch');
		await add(page).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('menuitem', { name: 'Add task after' })).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(page.getByRole('menuitem', { name: 'Add subtask' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);
		await expect(add(page)).toBeFocused();
	});
});

// The phone's Plan tab has the same control, in the tasks' header (no Gantt is on screen there): it
// sends `addTask` through the dispatcher, then shows the new task in the Gantt tab's details sheet.
test.describe('Add task (+) on the Plan tab', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name !== 'pixel-7', 'the Plan tab is the phone layout (Pixel 7)');
	});

	const planAdd = (page: Page) => page.locator('#panel-plan').getByTestId('add-task');
	const nameField = (page: Page) => page.getByRole('textbox', { name: 'Name', exact: true });

	async function openPlan(page: Page, rig: Rig): Promise<void> {
		await page.getByRole('tab', { name: 'Plan', exact: true }).tap();
		await expect(page.locator('#panel-plan').getByRole('treeitem').first()).toBeVisible();
		void rig;
	}

	async function expectNameReady(page: Page, key: string): Promise<void> {
		await expect(page.getByRole('tab', { name: 'Gantt', exact: true })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(nameField(page)).toBeFocused({ timeout: READY_TIMEOUT_MS });
		await expect(nameField(page)).toHaveValue('New task');
		const sel = await nameField(page).evaluate((el: HTMLInputElement) => [
			el.selectionStart,
			el.selectionEnd,
		]);
		expect(sel).toEqual([0, 'New task'.length]);
		await expect(page.locator(`[role="row"][data-key="${key}"]`)).toHaveAttribute(
			'aria-selected',
			'true',
		);
	}

	test('nothing selected: adds at the end of the plan; Undo removes it', async ({ page }, info) => {
		const rig = await Rig.open(page, info);
		const before = (await rig.text()) + (await rig.text('lib/build.tji'));
		await openPlan(page, rig);
		await expect(planAdd(page)).not.toHaveAttribute('aria-haspopup', 'menu');
		const box = await planAdd(page).boundingBox();
		expect(box?.width).toBeGreaterThanOrEqual(44);
		expect(box?.height).toBeGreaterThanOrEqual(44);
		await planAdd(page).tap();
		await expectNameReady(page, 'task:new_task');
		const after = (await rig.text()) + (await rig.text('lib/build.tji'));
		expect(after).toContain('task new_task "New task"');
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.getByTestId('undo').click();
		await expect
			.poll(async () => (await rig.text()) + (await rig.text('lib/build.tji')))
			.toBe(before);
	});

	test('a task selected: Add task after puts it right after; Undo removes it', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await openPlan(page, rig);
		await page.locator('#panel-plan').locator('[role="treeitem"][data-key="task:launch"]').tap();
		await page.getByRole('tab', { name: 'Plan', exact: true }).tap();
		await expect(planAdd(page)).toHaveAttribute('aria-haspopup', 'menu');
		await planAdd(page).tap();
		await page.getByRole('menuitem', { name: 'Add task after' }).tap();
		await expectNameReady(page, 'task:new_task');
		expect(await rig.text()).toBe(
			before.replace(
				'  responsible dev1\n}\n\n',
				'  responsible dev1\n}\n\ntask new_task "New task"\n\n',
			),
		);
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.getByTestId('undo').click();
		await expect.poll(() => rig.text()).toBe(before);
	});

	test('the toast and History say "Added New task", then the rename', async ({ page }, info) => {
		const rig = await Rig.open(page, info);
		await openPlan(page, rig);
		await planAdd(page).tap();
		await expectNameReady(page, 'task:new_task');
		await expect(rig.edited.last()).toContainText('Added New task');
		await page.keyboard.type('Write the specs');
		await page.keyboard.press('Enter');
		await expect
			.poll(async () =>
				((await rig.text()) + (await rig.text('lib/build.tji'))).includes('"Write the specs"'),
			)
			.toBe(true);
		await page.getByTestId('undo').focus();
		await page.keyboard.press('Shift+F10');
		const sheet = page.getByRole('dialog', { name: 'History' });
		await expect(sheet).toBeVisible();
		const entries = sheet.getByTestId('history-entry');
		await expect(entries.nth(0)).toContainText('Renamed New task to Write the specs');
		await expect(entries.nth(1)).toContainText('Added New task');
	});

	test('the tree shows what the app has selected, and + adds after that', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const tab = (name: string) => page.getByRole('tab', { name, exact: true });
		const item = (key: string) =>
			page.locator('#panel-plan').locator(`[role="treeitem"][data-key="${key}"]`);
		await openPlan(page, rig);
		await item('task:spike').tap();
		// Select Launch in the Gantt, then come back to the Plan tab.
		await tab('Gantt').tap();
		await rig.row('task:launch').locator('.label').tap();
		await expect(rig.row('task:launch')).toHaveAttribute('aria-selected', 'true');
		await tab('Plan').tap();
		await expect(item('task:launch')).toHaveAttribute('aria-selected', 'true');
		await expect(item('task:spike')).toHaveAttribute('aria-selected', 'false');
		await planAdd(page).tap();
		await page.getByRole('menuitem', { name: 'Add task after' }).tap();
		await expectNameReady(page, 'task:new_task');
		expect(await rig.text()).toBe(
			before.replace(
				'  responsible dev1\n}\n\n',
				'  responsible dev1\n}\n\ntask new_task "New task"\n\n',
			),
		);
	});

	test('a person who has gone to another tab is not pulled back to the Gantt', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const rev = await rig.revision();
		await openPlan(page, rig);
		await planAdd(page).tap();
		await page.getByRole('tab', { name: 'Text', exact: true }).tap();
		await rig.rescheduled(rev);
		await page.waitForTimeout(1000);
		await expect(page.getByRole('tab', { name: 'Text', exact: true })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(page.getByRole('dialog', { name: /Task details/ })).toHaveCount(0);
		expect((await rig.text('lib/build.tji')) + (await rig.text())).toContain('task new_task');
	});
});

// A 360 px phone (the narrowest we design for): nothing in the toolbar is clipped or pushed off.
test.describe('Add task (+) at 360 px', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name !== 'pixel-7', 'a phone width (Pixel 7)');
	});

	test('every chip, the more button included, is inside the toolbar', async ({ page }, info) => {
		await page.setViewportSize({ width: 360, height: 780 });
		const rig = await Rig.open(page, info);
		await rig.row('task:launch').locator('.label').tap();
		const group = page.getByRole('group', { name: 'Gantt controls' });
		const g = await group.boundingBox();
		if (!g) throw new Error('no toolbar');
		const buttons = group.locator('button, select');
		const n = await buttons.count();
		expect(n).toBeGreaterThanOrEqual(5);
		for (let i = 0; i < n; i++) {
			const b = await buttons.nth(i).boundingBox();
			if (!b) continue;
			expect(b.x, `chip ${i} left`).toBeGreaterThanOrEqual(g.x - 0.5);
			expect(b.x + b.width, `chip ${i} right`).toBeLessThanOrEqual(g.x + g.width + 0.5);
		}
		const more = await page.getByTestId('row-menu').boundingBox();
		expect(more && more.x + more.width).toBeLessThanOrEqual(360);
		const add = await page.getByTestId('add-task').boundingBox();
		expect(add?.width).toBeGreaterThanOrEqual(44);
		expect(await group.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
	});
});

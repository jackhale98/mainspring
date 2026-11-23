// SPDX-License-Identifier: GPL-2.0-or-later
// "New plan…" (phase-3.md 9.8, T4; ADR-0013 #2), on desktop Chrome (a mouse) and the Pixel 7
// emulation (a finger): the chooser lists "New plan…" first and the samples in a group; the sheet
// validates the name and creates the header-only plan, listed as "Name (new)"; the + adds the
// first task, the name is typed, and the schedule runs; replacing an edited new plan with a
// sample asks first. The screenshots are new-plan-screenshots.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';

test.describe('New plan', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);

	const chooser = (page: Page) => page.getByLabel('Sample plan');
	const sheet = (page: Page) => page.getByRole('dialog', { name: 'New plan' });
	const nameInput = (page: Page) => sheet(page).getByLabel('Name', { exact: true });
	const text = (page: Page) =>
		page.evaluate(
			() =>
				(
					window as unknown as { __mainspringEdits: { text(): string | null } }
				).__mainspringEdits.text() ?? '',
		);

	async function open(page: Page): Promise<void> {
		await page.goto('/app?sample=poc-sample&mode=visual&hooks=edits,gantt');
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
	}

	async function tap(touch: boolean, target: ReturnType<Page['locator']>) {
		if (touch) await target.tap();
		else await target.click();
	}

	/** Opens the chooser's "New plan…" entry and fills the sheet (not submitted). */
	async function fill(page: Page, name: string, zone: string, start = '2026-11-16'): Promise<void> {
		await chooser(page).selectOption({ label: 'New plan…' });
		await expect(sheet(page)).toBeVisible();
		await nameInput(page).fill(name);
		await sheet(page).getByLabel('Start').fill(start);
		await sheet(page).getByLabel('Time zone').selectOption({ label: zone });
	}

	test('the chooser lists New plan… first, then the Samples group', async ({ page }) => {
		await open(page);
		const options = await chooser(page).evaluate((s: HTMLSelectElement) =>
			[...s.querySelectorAll('option, optgroup')].map((o) =>
				o.tagName === 'OPTGROUP'
					? `group:${(o as HTMLOptGroupElement).label}`
					: (o.textContent ?? ''),
			),
		);
		expect(options.slice(0, 3)).toEqual(['New plan…', 'group:Samples', 'Proof-of-concept plan']);
		// Choosing it opens the sheet and leaves the open plan in the chooser.
		await chooser(page).selectOption({ label: 'New plan…' });
		await expect(sheet(page)).toBeVisible();
		await expect(chooser(page).locator('option:checked')).toHaveText('Proof-of-concept plan');
	});

	test('creates the header-only plan, listed as "Name (new)"; + adds the first task, which is named and scheduled', async ({
		page,
	}, info) => {
		const touch = isTouch(info);
		await open(page);
		await fill(page, 'Website relaunch', 'Europe/Berlin');
		await tap(touch, sheet(page).getByRole('button', { name: 'Create' }));
		await expect(sheet(page)).toBeHidden();

		const header =
			'project website_relaunch "Website relaunch" 2026-11-16 +1y {\n  timezone "Europe/Berlin"\n}\n';
		await expect.poll(() => text(page)).toBe(header);
		await expect(chooser(page).locator('option:checked')).toHaveText('Website relaunch (new)');
		await expect(chooser(page).locator('option').nth(1)).toHaveText('Website relaunch (new)');
		// The new plan is stored at once (phase-4.md 18.7): the line says so where the layout has a
		// footer (not a phone).
		if (!touch)
			await expect(page.getByTestId('keep-line')).toHaveText(
				'Only in this browser. Changes are kept as you make them.',
			);

		// The first action is the +: nothing is selected, so it adds at the end, at once.
		const add = page.getByTestId('add-task');
		await expect(add).toBeVisible();
		await tap(touch, add);
		const name = page.getByRole('textbox', { name: 'Name', exact: true });
		await expect(name).toBeFocused({ timeout: READY_TIMEOUT_MS });
		await expect(name).toHaveValue('New task');
		await expect.poll(() => text(page)).toBe(`${header}task new_task "New task"\n`);

		await page.keyboard.type('Write the specs');
		await page.keyboard.press('Enter');
		// The first name also sets the id (polish 15): new_task becomes write_the_specs.
		await expect.poll(() => text(page)).toBe(`${header}task write_the_specs "Write the specs"\n`);
		await expect(page.locator('[role="row"][data-key="task:write_the_specs"]')).toBeVisible();

		// The schedule runs on the new text: the status leaves "No tasks yet" for a result.
		await expect(page.getByRole('group', { name: 'Plan status' })).not.toContainText('Scheduling', {
			timeout: READY_TIMEOUT_MS,
		});
		expect(await page.evaluate(() => document.title)).toBeTruthy();
	});

	test('an empty plan is not an error: "No tasks yet", the empty state adds the first task, and deleting it returns', async ({
		page,
	}, info) => {
		const touch = isTouch(info);
		await open(page);
		await fill(page, 'Empty one', 'None (UTC)');
		await tap(touch, sheet(page).getByRole('button', { name: 'Create' }));
		await expect(sheet(page)).toBeHidden();

		// The status is neutral: no error, no "not scheduled", no message without a place.
		const status = page.getByRole('group', { name: 'Plan status' });
		await expect(status).toContainText('No tasks yet', { timeout: READY_TIMEOUT_MS });
		await expect(status).not.toContainText(/error|Not scheduled|without a place/i);
		if (touch) {
			await expect(page.getByTestId('status-button')).toHaveAttribute('data-glyph', 'empty');
		} else {
			await expect(status).toContainText('No problems');
			await expect(status.getByRole('button', { name: /error|warning|message/i })).toHaveCount(0);
		}

		// The empty state: one sentence and the Add task button, the same flow as the +.
		const empty = page.getByTestId('empty-state');
		await expect(empty).toBeVisible();
		await expect(empty).toContainText('No tasks yet');
		await tap(touch, page.getByTestId('empty-add-task'));
		const name = page.getByRole('textbox', { name: 'Name', exact: true });
		await expect(name).toBeFocused({ timeout: READY_TIMEOUT_MS });
		await expect.poll(() => text(page)).toContain('task new_task "New task"');
		await page.keyboard.type('First task');
		await page.keyboard.press('Enter');
		await expect.poll(() => text(page)).toContain('task first_task "First task"');
		const row = page.locator('[role="row"][data-key="task:first_task"]');
		await expect(row).toBeVisible();
		await expect(empty).toHaveCount(0);
		await expect(status).not.toContainText('No tasks yet');

		// Deleting the only task goes back to the empty state, settled without an error.
		if (touch) {
			await row.locator('.label').tap();
			await expect(row).toHaveAttribute('aria-selected', 'true');
			await page.getByTestId('row-menu').tap();
			await page.getByRole('menuitem', { name: 'Delete' }).tap();
		} else {
			await row.focus();
			await page.keyboard.press('Delete');
		}
		await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(status).toContainText('No tasks yet');
		await expect(status).not.toContainText(/error|Not scheduled|without a place/i);
		// The deleted row held the focus: it goes to "Add task", not to the page.
		if (!touch) await expect(page.getByTestId('empty-add-task')).toBeFocused();
		await expect(
			page.getByTestId('toast').filter({ hasText: 'The plan has no tasks.' }),
		).toHaveText(/Deleted\. The plan has no tasks\./);
		await expect(page.getByTestId('toast').filter({ hasText: /no longer schedules/ })).toHaveCount(
			0,
		);
		expect(await text(page)).not.toContain('task first_task');
	});

	test('the empty state points to Text where no editor is on screen, and not in Split', async ({
		page,
	}, info) => {
		const touch = isTouch(info);
		await open(page);
		await fill(page, 'Pointer', 'None (UTC)');
		await tap(touch, sheet(page).getByRole('button', { name: 'Create' }));
		const empty = page.getByTestId('empty-state');
		await expect(empty).toBeVisible({ timeout: READY_TIMEOUT_MS });
		const link = page.getByRole('button', { name: 'or write them in Text' });
		if (touch) {
			await expect(link).toBeVisible();
		} else {
			// A desktop opens the new plan in Split: the editor is beside the chart, so no pointer.
			await expect(link).toHaveCount(0);
			await page.getByRole('button', { name: 'Visual' }).click();
			await expect(link).toBeVisible();
		}
		await tap(touch, link);
		await expect(page.getByRole('textbox', { name: /^Editor for / })).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});
	});

	test('the phone Plan tab shows the same empty state, and its button adds the first task', async ({
		page,
	}, info) => {
		test.skip(!isTouch(info), 'the Plan tab is the phone layout');
		await open(page);
		await fill(page, 'Plan tab', 'None (UTC)');
		await tap(true, sheet(page).getByRole('button', { name: 'Create' }));
		await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await page.getByRole('tab', { name: 'Plan', exact: true }).tap();
		const plan = page.locator('#panel-plan');
		await expect(plan.getByTestId('empty-state')).toBeVisible();
		await plan.getByTestId('empty-add-task').tap();
		// The flow takes the person to the Gantt tab, where the details open on the new task.
		await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused({
			timeout: READY_TIMEOUT_MS,
		});
		await expect.poll(() => text(page)).toContain('task new_task "New task"');
	});

	test('None (UTC) writes no time zone line', async ({ page }, info) => {
		await open(page);
		await fill(page, 'Launch', 'None (UTC)', '2027-01-04');
		await tap(isTouch(info), sheet(page).getByRole('button', { name: 'Create' }));
		await expect.poll(() => text(page)).toBe('project launch "Launch" 2027-01-04 +1y\n');
	});

	test('the name is required: an empty one is refused with a message and nothing is created', async ({
		page,
	}, info) => {
		const touch = isTouch(info);
		await open(page);
		const before = await text(page);
		await chooser(page).selectOption({ label: 'New plan…' });
		await expect(sheet(page)).toBeVisible();
		await tap(touch, sheet(page).getByRole('button', { name: 'Create' }));
		await expect(sheet(page)).toBeVisible();
		await expect(nameInput(page)).toHaveAttribute('aria-invalid', 'true');
		await expect(sheet(page).getByRole('alert')).toHaveText('Give the plan a name.');
		await expect(nameInput(page)).toBeFocused();
		expect(await text(page)).toBe(before);
		// Typing clears the message; spaces alone are still empty.
		await nameInput(page).fill('   ');
		await page.keyboard.press('Enter');
		await expect(sheet(page).getByRole('alert')).toHaveText('Give the plan a name.');
		await nameInput(page).fill('Ok');
		await expect(sheet(page).getByRole('alert')).toHaveCount(0);
		// Enter in the field creates.
		await page.keyboard.press('Enter');
		await expect(sheet(page)).toBeHidden();
		await expect(chooser(page).locator('option:checked')).toHaveText('Ok (new)');
	});

	test('a start after 2035 is refused (the engine would say time_error), and the field limits it', async ({
		page,
	}, info) => {
		await open(page);
		const before = await text(page);
		await chooser(page).selectOption({ label: 'New plan…' });
		await nameInput(page).fill('Far future');
		const start = sheet(page).getByLabel('Start');
		await expect(start).toHaveAttribute('min', '1970-01-01');
		await expect(start).toHaveAttribute('max', '2035-12-31');
		await start.fill('2036-01-01');
		await tap(isTouch(info), sheet(page).getByRole('button', { name: 'Create' }));
		await expect(sheet(page)).toBeVisible();
		await expect(sheet(page).getByRole('alert')).toHaveText(
			'Enter a start date from 1970 to 2035.',
		);
		await expect(start).toBeFocused();
		expect(await text(page)).toBe(before);
		// The last day the engine reads is accepted.
		await start.fill('2035-12-31');
		await tap(isTouch(info), sheet(page).getByRole('button', { name: 'Create' }));
		await expect(sheet(page)).toBeHidden();
		await expect.poll(() => text(page)).toContain('far_future "Far future" 2035-12-31 +1y');
	});

	test('what is typed in the sheet survives a layout change while it is open', async ({
		page,
	}, info) => {
		test.skip(isTouch(info), 'resizes the desktop window across the phone breakpoint');
		await page.setViewportSize({ width: 1280, height: 800 });
		await open(page);
		await chooser(page).selectOption({ label: 'New plan…' });
		await nameInput(page).fill('Kept answers');
		await sheet(page).getByLabel('Start').fill('2027-03-01');
		await sheet(page).getByLabel('Time zone').selectOption({ label: 'Europe/Berlin' });
		// The top bar swaps its desktop branch for the phone's: the chip remounts.
		await page.setViewportSize({ width: 420, height: 800 });
		await expect(sheet(page)).toBeVisible();
		await expect(nameInput(page)).toHaveValue('Kept answers');
		await expect(sheet(page).getByLabel('Start')).toHaveValue('2027-03-01');
		await expect(sheet(page).getByLabel('Time zone')).toHaveValue('Europe/Berlin');
	});

	test('Escape and Cancel close the sheet without creating', async ({ page }, info) => {
		await open(page);
		const before = await text(page);
		await chooser(page).selectOption({ label: 'New plan…' });
		await expect(sheet(page)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(sheet(page)).toBeHidden();
		await chooser(page).selectOption({ label: 'New plan…' });
		await tap(isTouch(info), sheet(page).getByRole('button', { name: 'Cancel' }));
		await expect(sheet(page)).toBeHidden();
		expect(await text(page)).toBe(before);
	});

	test('a new plan is kept in the browser, so switching never asks, edited or not', async ({
		page,
	}, info) => {
		// Phase 4 (18.7): a new plan is stored at once and autosaved, so nothing is lost by a switch.
		const touch = isTouch(info);
		await open(page);
		let asked = 0;
		page.on('dialog', (d) => {
			asked++;
			void d.dismiss();
		});
		const create = async (name: string) => {
			await fill(page, name, 'None (UTC)');
			await tap(touch, sheet(page).getByRole('button', { name: 'Create' }));
			await expect(sheet(page)).toBeHidden();
		};

		// Unedited: a sample replaces it, and "Draft (new)" leaves the list (T15's chooser lists the
		// plans kept here).
		await create('Draft');
		await expect(chooser(page).locator('option:checked')).toHaveText('Draft (new)');
		await chooser(page).selectOption({ label: 'TaskJuggler tutorial' });
		await expect(chooser(page).locator('option:checked')).toHaveText('TaskJuggler tutorial');
		await expect(chooser(page).locator('option', { hasText: '(new)' })).toHaveCount(0);

		// Edited: no question either.
		await create('Draft');
		await expect(chooser(page).locator('option:checked')).toHaveText('Draft (new)');
		await tap(touch, page.getByTestId('add-task'));
		await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused({
			timeout: READY_TIMEOUT_MS,
		});
		await page.keyboard.press('Enter');
		await expect.poll(() => text(page)).toContain('task new_task');
		await chooser(page).selectOption({ label: 'TaskJuggler tutorial' });
		await expect(chooser(page).locator('option:checked')).toHaveText('TaskJuggler tutorial');

		// Another new plan from an edited one does not ask.
		await create('Second');
		await expect(chooser(page).locator('option:checked')).toHaveText('Second (new)');
		await tap(touch, page.getByTestId('add-task'));
		await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused({
			timeout: READY_TIMEOUT_MS,
		});
		await page.keyboard.press('Enter');
		await expect.poll(() => text(page)).toContain('task new_task');
		await create('Third');
		await expect(chooser(page).locator('option:checked')).toHaveText('Third (new)');
		await expect.poll(() => text(page)).toBe('project third "Third" 2026-11-16 +1y\n');
		expect(asked).toBe(0);
	});
});

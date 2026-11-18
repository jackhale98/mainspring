// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A rig for the resource table and person details specs (phase-3.md 13.2, T17): opens a plan in the
 * Resources view (the desktop's view switcher: the table beside the lanes) or on the phone's People
 * tab, Team segment (the table alone), finds rows by the person's id, drags a row's grip with a
 * mouse or a finger (a long-press through the DevTools protocol), and reads and undoes edits the
 * way the calendar rig does (the entry file's text through the `edits` hook).
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { READY_TIMEOUT_MS, Rig, isTouch } from './gantt-rig';

export { caughtUp, changed, redo, text, textOf, undo } from './calendar-rig';

/** `poc-sample`: one file; a group `dev` with Jack and Ana, and the reviewer, who all have tasks. */
export const PLAN = 'poc-sample';

export async function openResources(
	page: Page,
	info: TestInfo,
	opts: { plan?: string; scheme?: 'light' | 'dark'; hooks?: string } = {},
): Promise<void> {
	if (opts.scheme) await page.emulateMedia({ colorScheme: opts.scheme });
	const plan = opts.plan ?? PLAN;
	const hooks = opts.hooks ?? 'edits,lanes';
	await page.goto(
		isTouch(info)
			? `/app?sample=${plan}&hooks=${hooks}`
			: `/app?sample=${plan}&mode=visual&view=resources&hooks=${hooks}`,
	);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	if (isTouch(info)) {
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
		await page.getByRole('tab', { name: 'Team' }).tap();
	}
	await expect(page.getByTestId('resource-row').first()).toBeVisible({ timeout: 60_000 });
}

/** The row of a person, by id. */
export const row = (page: Page, id: string): Locator =>
	page.locator(`[data-testid="resource-row"][data-key="resource:${id}"]`);

/** The ids of the rows on screen, in order. */
export const rowIds = (page: Page): Promise<string[]> =>
	page
		.locator('[data-testid="resource-row"]')
		.evaluateAll((rows) =>
			rows.map((r) => (r.getAttribute('data-key') ?? '').replace(/^resource:/, '')),
		);

/** A click, or a finger's tap, on a row (a finger's first tap selects, the second opens the details). */
export async function selectRow(page: Page, info: TestInfo, id: string): Promise<void> {
	const r = row(page, id);
	await r.scrollIntoViewIfNeeded();
	const name = r.getByRole('rowheader');
	if (isTouch(info)) await name.tap({ position: { x: 120, y: 12 } });
	else await name.click({ position: { x: 120, y: 12 } });
}

/** The person details, on screen: the right panel, or the bottom sheet after the second tap. */
export async function openPerson(page: Page, info: TestInfo, id: string): Promise<Locator> {
	await selectRow(page, info, id);
	if (isTouch(info) && !(await page.getByTestId('person-details').isVisible())) {
		await selectRow(page, info, id);
	}
	const d = page.getByTestId('person-details');
	await expect(d).toBeVisible({ timeout: 30_000 });
	return d;
}

async function centre(l: Locator): Promise<{ x: number; y: number }> {
	const b = await l.boundingBox();
	if (!b) throw new Error('no box');
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Drags a row by its grip to a point `dy` rows below and `dx` px to the right of its own place: a
 * mouse presses and moves; a finger holds for the long-press (450 ms, past the machine's 350) and
 * then moves (7.2). The grip shows on the row under the pointer (a finger's, on the selected row).
 */
export async function dragRow(
	page: Page,
	info: TestInfo,
	id: string,
	dx: number,
	dy: number,
): Promise<void> {
	const r = row(page, id);
	await r.scrollIntoViewIfNeeded();
	if (isTouch(info)) await selectRow(page, info, id);
	else await r.hover();
	const a = await centre(r.getByTestId('resource-grip'));
	const steps = 8;
	if (isTouch(info)) {
		// Real touch events on the Pixel 7, dispatched touch pointers on the iPhone (Rig.drag).
		const rig = new Rig(page, info);
		try {
			await rig.drag(a, { x: a.x + dx, y: a.y + dy }, { hold: 450, steps });
		} finally {
			await rig.detach();
		}
	} else {
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		for (let i = 1; i <= steps; i++) {
			await page.mouse.move(a.x + (dx * i) / steps, a.y + (dy * i) / steps);
		}
		await page.mouse.up();
	}
}

/** Adds a person or a group from the toolbar: types the name and presses Enter. */
export async function add(page: Page, kind: 'person' | 'group', name: string): Promise<void> {
	await page.getByTestId(kind === 'group' ? 'add-group' : 'add-person-row').click();
	const input = page.getByTestId('add-form').getByRole('textbox');
	await input.fill(name);
	await input.press('Enter');
}

/** The newest toast's text, or ''. */
export async function toast(page: Page): Promise<string> {
	return (await page.locator('[role="status"], [role="alert"]').allInnerTexts()).join(' ');
}

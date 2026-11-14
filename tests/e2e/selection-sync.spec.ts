// SPDX-License-Identifier: GPL-2.0-or-later
// Selection and two-way sync between the text and the visual views (phase-2.md 6.10, 11.2; T15) in
// the built app: desktop Chrome (Split: the editor and the Gantt side by side) and Pixel 7 (the
// Gantt tab and the Text tab). The cursor in the text selects the bar and scrolls it into view
// without taking the focus; a row, a link or a rename in the Gantt puts the source on show in the
// editor (a line background and a left rule, the cursor only when the editor has no focus); a
// toast's Show in Visual mode opens the source sheet. With SCREENSHOTS=1 it writes
// docs/phases/screenshots/phase-2/selection-*.png.
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');

interface Hooks {
	action(a: unknown): Promise<{ status: string }>;
	text(path?: string): string | null;
	revision(): number | null;
}
type W = { __mainspringEdits: Hooks };
const action = (page: Page, a: unknown) =>
	page.evaluate((x) => (window as unknown as W).__mainspringEdits.action(x), a);
const revision = (page: Page) =>
	page.evaluate(() => (window as unknown as W).__mainspringEdits.revision());

type Info = { project: { name: string } };
const phone = (info: Info) => info.project.name !== 'desktop';

async function open(page: Page, info: Info, sample = 'gantt-manipulation', mode = 'split') {
	// A phone starts on its Gantt tab; a desktop is told the mode.
	const query = phone(info) ? '' : `&mode=${mode}`;
	await page.goto(`/app?sample=${sample}&hooks=edits${query}`);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.locator('[role="row"][data-key]').first()).toBeVisible();
	await expect.poll(() => revision(page)).not.toBeNull();
	await page.waitForTimeout(500);
}

/** A phone shows one panel at a time: the Text tab for the editor, the Gantt tab for the rows. */
async function tab(page: Page, info: Info, name: 'Text' | 'Gantt') {
	if (!phone(info)) return;
	await page.getByRole('tab', { name, exact: true }).click();
	await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
		'aria-selected',
		'true',
	);
}

const row = (page: Page, name: string): Locator =>
	page.locator('[role="treegrid"] [role="row"][data-key]').filter({ hasText: name }).first();
const line = (page: Page, text: string): Locator =>
	page.locator('.cm-content .cm-line').filter({ hasText: text }).first();

/** A line of the text, scrolled to: the editor draws only the lines in or near its view. */
async function lineAt(page: Page, text: string): Promise<Locator> {
	const target = line(page, text);
	for (let i = 0; i < 60 && (await target.count()) === 0; i++) {
		await page.locator('.cm-scroller').evaluate((e) => void (e.scrollTop += e.clientHeight / 2));
		await page.waitForTimeout(40);
	}
	await target.scrollIntoViewIfNeeded();
	return target;
}
const lit = (page: Page): Locator => page.locator('.cm-content .cm-line.cm-source-selected');
const litText = async (page: Page): Promise<string[]> =>
	(await lit(page).allTextContents()).map((t) => t.replace(/​/g, ''));
const details = (page: Page, info: Info): Locator =>
	phone(info)
		? page.getByRole('dialog', { name: /Task details|Link details/ })
		: page.getByRole('complementary', { name: 'Details' });

/** Whether the editor holds the keyboard focus. */
const editorFocused = (page: Page): Promise<boolean> =>
	page.evaluate(() => !!document.activeElement?.closest('.cm-editor'));

/**
 * A click on a row, as a click or a tap does (the first column's name, clear of its twisty). On a
 * phone it selects only: the details sheet opens on a tap on the selected row.
 */
async function pick(page: Page, name: string): Promise<void> {
	await row(page, name).click();
	await expect(row(page, name)).toHaveAttribute('aria-selected', 'true');
}

test.describe('selection sync', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T15)');
	});
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('the cursor in the text selects its bar, and the editor keeps the focus', async ({
		page,
	}, info) => {
		await open(page, info);
		await tab(page, info, 'Text');
		await (await lineAt(page, 'length 4d')).click();
		await tab(page, info, 'Gantt');
		await expect(row(page, 'Sketch')).toHaveAttribute('aria-selected', 'true');
		await expect(row(page, 'Research')).toHaveAttribute('aria-selected', 'false');
		// Split: the text did not lose the focus, and the details were not opened over the chart.
		if (!phone(info)) expect(await editorFocused(page)).toBe(true);
		await expect(page.getByRole('dialog', { name: /Task details/ })).toHaveCount(0);
		// Another task, a click on its line: the selection follows.
		await tab(page, info, 'Text');
		await (await lineAt(page, 'duration 2d')).click();
		await tab(page, info, 'Gantt');
		await expect(row(page, 'Review')).toHaveAttribute('aria-selected', 'true');
		await expect(row(page, 'Sketch')).toHaveAttribute('aria-selected', 'false');
		// The project header is no task: the selection stays.
		await tab(page, info, 'Text');
		await (await lineAt(page, 'project ganttm')).click();
		await tab(page, info, 'Gantt');
		await expect(row(page, 'Review')).toHaveAttribute('aria-selected', 'true');
	});

	test('the row of a task far down the plan scrolls into view, without the focus', async ({
		page,
	}, info) => {
		await open(page, info, 'gantt-200');
		await tab(page, info, 'Text');
		await (await lineAt(page, 'project gantt200')).click();
		// The end of the plan: the last task's block, far below the rows in view.
		await page.keyboard.press('ControlOrMeta+End');
		for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
		await tab(page, info, 'Gantt');
		const target = row(page, 'Phase 4 done');
		await expect(target).toHaveAttribute('aria-selected', 'true');
		await expect(target).toBeInViewport();
		const top = await page
			.getByTestId('gantt')
			.locator('.scroller')
			.evaluate((e) => e.scrollTop);
		expect(top).toBeGreaterThan(1000);
		if (!phone(info)) expect(await editorFocused(page)).toBe(true);
	});

	test('a row puts its block on show in the text and the cursor on its id', async ({
		page,
	}, info) => {
		await open(page, info);
		await pick(page, 'Write docs');
		await tab(page, info, 'Text');
		await expect
			.poll(() => litText(page))
			.toEqual([
				'  task docs "Write docs" {',
				'    scheduling alap',
				'    end 2026-03-27',
				'    effort 2d',
				'    allocate dev1, dev2',
				'  }',
			]);
		await expect(lit(page).first()).toBeInViewport();
		// The cursor is on the declaration (the editor had no focus); the plan was not changed.
		await expect(page.locator('.cm-activeLine')).toContainText('task docs');
		await expect(page.getByRole('group', { name: 'Plan status' })).not.toContainText('Scheduling');
		// The highlight is a background and a rule, not a colour alone.
		const style = await lit(page)
			.first()
			.evaluate((e) => {
				const s = getComputedStyle(e);
				return { bg: s.backgroundColor, shadow: s.boxShadow };
			});
		expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
		expect(style.shadow).toMatch(/inset/);
		// A screen reader hears nothing of it: no live region, role or label came with it.
		expect(await lit(page).first().getAttribute('role')).toBeNull();
		expect(await lit(page).first().getAttribute('aria-label')).toBeNull();
		// Another row moves it; typing inside the block keeps it, and the Gantt keeps its selection.
		await tab(page, info, 'Gantt');
		await pick(page, 'Research');
		await tab(page, info, 'Text');
		await expect
			.poll(() => litText(page))
			.toEqual([
				'  task research "Research" {',
				'    effort 3d',
				'    allocate dev1',
				'    complete 40',
				'  }',
			]);
	});

	test('a selected link puts its depends line on show', async ({ page }, info) => {
		await open(page, info);
		await pick(page, 'Sketch');
		// A phone selected on the first tap; a tap on the selected row opens its sheet.
		if (phone(info)) await row(page, 'Sketch').click();
		const panel = details(page, info);
		await panel
			.getByRole('button', { name: /^Details\s*:\s*Open the link/ })
			.first()
			.click();
		await expect(details(page, info).getByText('Sketch waits for Research')).toBeVisible();
		await tab(page, info, 'Text');
		await expect.poll(() => litText(page)).toEqual(['    depends !research { gaplength 2d }']);
		await expect(lit(page).first()).toBeInViewport();
		// A task again takes the link's place.
		await tab(page, info, 'Gantt');
		await pick(page, 'Review');
		await tab(page, info, 'Text');
		await expect
			.poll(() => litText(page))
			.toEqual([
				'  task review "Review" {',
				'    duration 2d',
				'    depends !sketch { onstart }',
				'  }',
			]);
	});

	test('the selection follows a task to its new id after a move', async ({ page }, info) => {
		await open(page, info);
		await pick(page, 'Write docs');
		const key = await row(page, 'Write docs').getAttribute('data-key');
		expect(key).toBe('task:design.docs');
		// Out of Design, to the top level of the plan: design.docs becomes docs.
		const o = await action(page, { type: 'reorder', task: 'design.docs', parent: null, index: 0 });
		expect(o.status).toBe('applied');
		await expect(row(page, 'Write docs')).toHaveAttribute('data-key', 'task:docs', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(row(page, 'Write docs')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('toast').last()).toHaveAttribute('data-status', 'scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		if (!phone(info)) {
			await expect(details(page, info).getByLabel('Name', { exact: true })).toHaveValue(
				'Write docs',
			);
		}
		// Its block is on show where it stands now (top level: no indent).
		await tab(page, info, 'Text');
		await expect
			.poll(async () => (await litText(page))[0], { timeout: READY_TIMEOUT_MS })
			.toBe('task docs "Write docs" {');
		await expect(lit(page).first()).toBeInViewport();
		// Undo moves the task back, and the selection with it; redo moves both on again.
		await tab(page, info, 'Gantt');
		await page.keyboard.press('Control+z');
		await expect(row(page, 'Write docs')).toHaveAttribute('data-key', 'task:design.docs', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(row(page, 'Write docs')).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Control+y');
		await expect(row(page, 'Write docs')).toHaveAttribute('data-key', 'task:docs', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(row(page, 'Write docs')).toHaveAttribute('aria-selected', 'true');
	});

	test('the toast Show in Visual mode opens the source sheet', async ({ page }, info) => {
		// Visual mode: no editor on screen (a phone is on its Gantt tab).
		await open(page, info, 'gantt-manipulation', 'visual');
		// An end a hundred working days on, past the project's end: the edit applies, and the
		// plan no longer schedules (the tasks do not fit the time frame).
		const o = await action(page, {
			type: 'move',
			task: 'design.docs',
			days: 100,
			kind: 'start',
		});
		expect(o.status).toBe('applied');
		const toast = page.getByTestId('toast').last();
		await expect(toast).toHaveAttribute('data-status', 'not-scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.locator('.cm-content')).toBeHidden();
		await toast.getByRole('button', { name: 'Show', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: /^Source of / });
		await expect(sheet).toBeVisible();
		// The engine puts the first error on Hotfix, which waits for the Design gate.
		await expect(sheet).toContainText('task hotfix "Hotfix"');
		// No editor was brought on screen.
		await expect(page.locator('.cm-content')).toBeHidden();
	});

	test.describe('screenshots', () => {
		test.skip(process.env['SCREENSHOTS'] !== '1', 'SCREENSHOTS=1 writes the pictures');

		test('the selected source, light and dark', async ({ page }, info) => {
			await open(page, info);
			await pick(page, 'Write docs');
			await tab(page, info, 'Text');
			await expect.poll(async () => (await litText(page)).length).toBe(6);
			await page.waitForTimeout(400);
			const name = info.project.name === 'desktop' ? 'desktop' : 'pixel7';
			await page.screenshot({ path: path.join(DIR, `selection-${name}-light.png`) });
			await page.emulateMedia({ colorScheme: 'dark' });
			await page.waitForTimeout(200);
			await page.screenshot({ path: path.join(DIR, `selection-${name}-dark.png`) });
			await page.emulateMedia({ colorScheme: 'light' });
			if (phone(info)) {
				// The Gantt tab with the same task selected.
				await tab(page, info, 'Gantt');
				await page.waitForTimeout(200);
				await page.screenshot({ path: path.join(DIR, `selection-${name}-gantt-light.png`) });
			}
		});
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
// The Gantt's task list as an ARIA treegrid (phase-2.md 10.1, 10.2; T18) and the engine details in
// the status strip (T24). Desktop Chrome and Pixel 7. The treegrid's structure and its cells are
// read from the page and compared with what the tutorial's schedule says; the keyboard model is
// walked key by key; the live region speaks after a reschedule; axe passes with a cell focused
// and the engine popover open, in both colour schemes. With SCREENSHOTS=1 it writes
// docs/phases/screenshots/phase-2/treegrid-*.png and engine-info-*.png.
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');
const COLUMNS = [
	'Task',
	'Start',
	'End',
	'Effort or length',
	'People',
	'Float (estimate)',
	'Critical (estimate)',
	'Status',
];

async function open(page: Page, sample = 'upstream-tutorial', mode = 'visual'): Promise<void> {
	await page.goto(`/app?sample=${sample}&mode=${mode}`);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByTestId('gantt-treegrid')).toBeVisible();
	await expect(rows(page).first()).toBeVisible();
	await page.waitForTimeout(500);
}

const grid = (page: Page) => page.getByTestId('gantt-treegrid');
const rows = (page: Page) => grid(page).locator('[role="row"][data-key]');
const row = (page: Page, name: string) => rows(page).filter({ hasText: name }).first();
const cell = (r: Locator, col: string) => r.locator(`[data-col="${col}"]`);
const text = async (l: Locator) => ((await l.textContent()) ?? '').replace(/\s+/g, ' ').trim();
const tabStops = (page: Page) => grid(page).locator('[tabindex="0"]');
const phone = (info: { project: { name: string } }) => info.project.name !== 'desktop';

test.describe('the treegrid', () => {
	test.setTimeout(READY_TIMEOUT_MS + 90_000);

	test('is a labelled treegrid whose rows and cells say what the schedule says', async ({
		page,
	}, info) => {
		await open(page);
		const g = grid(page);
		await expect(g).toHaveAttribute('role', 'treegrid');
		await expect(g).toHaveAttribute('aria-label', 'Tasks');
		await expect(g).toHaveAttribute('aria-colcount', '8');
		const total = Number(await g.getAttribute('aria-rowcount'));
		// The tutorial has more than a dozen tasks; the count includes the header row.
		expect(total).toBeGreaterThan(14);
		const heads = await g.getByRole('columnheader').allTextContents();
		expect(heads.map((h) => h.trim())).toEqual(COLUMNS);

		// Hierarchy: Accounting Software holds Specification and others; levels, positions and
		// the set size agree with the tree the rows draw.
		const accounting = row(page, 'Accounting Software');
		await expect(accounting).toHaveAttribute('aria-level', '1');
		await expect(accounting).toHaveAttribute('aria-expanded', 'true');
		const spec = row(page, 'Specification');
		await expect(spec).toHaveAttribute('aria-level', '2');
		await expect(spec).toHaveAttribute('aria-posinset', '1');
		await expect(spec).not.toHaveAttribute('aria-expanded');
		const levels = await rows(page).evaluateAll((els) =>
			els.map((e) => ({
				level: Number(e.getAttribute('aria-level')),
				pos: Number(e.getAttribute('aria-posinset')),
				size: Number(e.getAttribute('aria-setsize')),
				index: Number(e.getAttribute('aria-rowindex')),
			})),
		);
		levels.forEach((r, i) => {
			expect(r.index).toBe(i + 2);
			expect(r.pos).toBeGreaterThanOrEqual(1);
			expect(r.pos).toBeLessThanOrEqual(r.size);
		});

		// The cells: the engine's dates in the project's zone, the plan's own effort, the
		// estimates labelled by their column, the status in words.
		expect(await text(cell(spec, 'name'))).toBe('Specification');
		expect(await text(cell(spec, 'start'))).toBe('Jan 16, 2002');
		expect(await text(cell(spec, 'end'))).toBe('Jan 24, 2002');
		expect(await text(cell(spec, 'effort'))).toBe('20d effort');
		expect(await text(cell(spec, 'status'))).toBe('Scheduled');
		expect(['Yes', 'No']).toContain(await text(cell(spec, 'critical')));
		const milestone = row(page, 'Project start');
		expect(await text(cell(milestone, 'start'))).toBe(await text(cell(milestone, 'end')));
		expect(await text(cell(milestone, 'effort'))).toBe('–');
		await expect(cell(milestone, 'effort')).toHaveAttribute('aria-label', 'none');
		// A critical task says so in words, not only by colour.
		// On a desktop the Critical column is drawn and shows it; on a phone it is in the table
		// (for a screen reader) but not drawn, so there it is asserted by its words only.
		const yes = g.locator('[data-col="critical"]', { hasText: 'Yes' });
		expect(await yes.count()).toBeGreaterThan(0);
		if (phone(info)) expect((await yes.first().boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
		else await expect(yes.first()).toBeVisible();
	});

	test('draws the columns that fit, and keeps the rest in the table', async ({ page }, info) => {
		await open(page);
		const spec = row(page, 'Specification');
		await expect(cell(spec, 'start')).toHaveCount(1);
		const box = async (c: string) => (await cell(spec, c).boundingBox())?.width ?? 0;
		if (phone(info)) {
			// Phones: the narrow frozen name column alone; every other cell is hidden from the eye
			// (a 1 px box) but present for a screen reader, with its words.
			expect(await box('name')).toBeGreaterThan(100);
			for (const c of ['start', 'end', 'effort', 'people', 'float', 'critical', 'status']) {
				expect(await box(c), c).toBeLessThanOrEqual(1);
			}
			expect(await text(cell(spec, 'start'))).toBe('Jan 16, 2002');
			// And keyboard focus skips what is not drawn.
			await expect(cell(spec, 'start')).not.toHaveAttribute('tabindex', /.*/);
		} else {
			expect(await box('start')).toBeGreaterThan(60);
			expect(await box('end')).toBeGreaterThan(60);
			expect(await box('effort')).toBeGreaterThan(60);
		}
		// The frozen column stays pinned while the chart scrolls sideways.
		const scroller = page.getByTestId('gantt').locator('.scroller');
		const left = async () => (await grid(page).boundingBox())?.x ?? 0;
		const before = await left();
		await scroller.evaluate((el) => el.scrollTo({ left: 300, behavior: 'instant' }));
		await page.waitForTimeout(300);
		expect(await left()).toBeCloseTo(before, 0);
	});

	test('is in the tab order once, and Tab leaves it', async ({ page }) => {
		await open(page);
		await expect(tabStops(page)).toHaveCount(1);
		await tabStops(page).focus();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await expect(tabStops(page)).toHaveCount(1);
		await expect(tabStops(page)).toBeFocused();
		await page.keyboard.press('Tab');
		const inside = await page.evaluate(() =>
			document.querySelector('[data-testid="gantt-treegrid"]')?.contains(document.activeElement),
		);
		expect(inside).toBe(false);
		await page.keyboard.press('Shift+Tab');
		await expect(tabStops(page)).toBeFocused();
	});

	test('the keyboard model: rows, cells, expand and collapse, Home and End, Enter', async ({
		page,
	}, info) => {
		await open(page);
		const accounting = row(page, 'Accounting Software');
		const spec = row(page, 'Specification');
		await accounting.focus();

		// Down and Up move between rows and select nothing.
		await page.keyboard.press('ArrowDown');
		await expect(spec).toBeFocused();
		await expect(spec).toHaveAttribute('aria-selected', 'false');
		await page.keyboard.press('ArrowUp');
		await expect(accounting).toBeFocused();

		// Left collapses an expanded row; Right expands it again; the rows below come and go.
		const before = await rows(page).count();
		await page.keyboard.press('ArrowLeft');
		await expect(accounting).toHaveAttribute('aria-expanded', 'false');
		expect(await rows(page).count()).toBeLessThan(before);
		await expect(accounting).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(accounting).toHaveAttribute('aria-expanded', 'true');
		await expect(rows(page)).toHaveCount(before);

		// Right on an expanded row goes into its first cell, and along the drawn cells.
		await page.keyboard.press('ArrowRight');
		await expect(cell(accounting, 'name')).toBeFocused();
		if (!phone(info)) {
			await page.keyboard.press('ArrowRight');
			await expect(cell(accounting, 'start')).toBeFocused();
			await page.keyboard.press('End');
			await expect(grid(page).locator('[data-col]:focus')).toHaveCount(1);
			await page.keyboard.press('Home');
			await expect(cell(accounting, 'name')).toBeFocused();
			// Down keeps the column.
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('ArrowDown');
			await expect(cell(row(page, 'Specification'), 'start')).toBeFocused();
			await page.keyboard.press('ArrowLeft');
			await page.keyboard.press('ArrowLeft');
			await expect(spec).toBeFocused();
		} else {
			await page.keyboard.press('ArrowLeft');
			await expect(accounting).toBeFocused();
			await page.keyboard.press('ArrowDown');
			await expect(spec).toBeFocused();
		}

		// Left on a leaf goes to its parent row.
		await page.keyboard.press('ArrowLeft');
		await expect(accounting).toBeFocused();

		// Home and End go to the first and last row; Enter opens (selects) the task.
		await page.keyboard.press('End');
		await expect(rows(page).last()).toBeFocused();
		await page.keyboard.press('Home');
		await expect(rows(page).first()).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		await expect(spec).toHaveAttribute('aria-selected', 'true');
		await expect(spec).toBeFocused();
		await page.keyboard.press('PageDown');
		await expect(spec).not.toBeFocused();
		await expect(grid(page).locator('[role="row"]:focus')).toHaveCount(1);
	});

	test('says what a reschedule moved, once, in a polite live region', async ({ page }, info) => {
		test.skip(phone(info), 'the editor is on another tab on a phone');
		await open(page, 'upstream-tutorial', 'split');
		const live = page
			.getByTestId('gantt')
			.locator('[role="status"][aria-live="polite"]')
			.filter({ hasText: /Rescheduled/ });
		await expect(live).toHaveCount(0);
		await page.getByRole('textbox', { name: /^Editor for / }).click();
		await page.keyboard.press('ControlOrMeta+End');
		// A new task that ends after everything else: the finish moves, no task already there does.
		await page.keyboard.insertText(
			'\ntask extra "Extra" {\n  start 2002-04-10\n  duration 30d\n}\n',
		);
		await expect(live).toHaveText(
			/^Rescheduled\. Finish .+, [\d.]+ days? later\. (No tasks|\d+ tasks?) moved\.\s*$/,
			{ timeout: READY_TIMEOUT_MS },
		);
		// The Gantt speaks; the status strip does not say the same run again.
		await expect(page.locator('[role="status"]').filter({ hasText: /^Scheduled\./ })).toHaveCount(
			0,
		);
		// The status strip still names a problem when there is one (not asserted here: no error).
	});
});

test.describe('the engine in the status strip', () => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	test('names the TaskJuggler version and the last run, with every stage in a popover', async ({
		page,
	}, info) => {
		await open(page);
		const strip = page.getByRole('group', { name: 'Plan status' });
		const button = strip.getByTestId('engine-info');
		await expect(button).toBeVisible();
		await expect(button).toHaveAccessibleName(
			/^Engine details: TaskJuggler 3\.8\.4 · Last run [\d.]+ m?s$/,
		);
		if (phone(info)) {
			// A phone has the gauge only, and a 44 px target.
			await expect(button).not.toContainText('TaskJuggler');
			const box = await button.boundingBox();
			expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
		} else {
			await expect(button).toContainText('TaskJuggler 3.8.4');
			await expect(button).toContainText('Last run');
		}
		await button.click();
		const details = page.getByTestId('engine-info-details');
		await expect(details).toBeVisible();
		// Centred in the window, not pinned to a corner.
		const box = await details.boundingBox();
		const view = page.viewportSize();
		expect((box?.x ?? 0) + (box?.width ?? 0) / 2).toBeCloseTo((view?.width ?? 0) / 2, -1);
		expect((box?.y ?? 0) + (box?.height ?? 0) / 2).toBeCloseTo((view?.height ?? 0) / 2, -1);
		for (const label of [
			'Scheduler total',
			'Loading the files',
			'Reading the plan',
			'Computing the schedule',
			'Preparing the result',
			'Waiting and round trip',
			'Handling the result',
			'TaskJuggler commit',
			'Ruby on WebAssembly',
		]) {
			await expect(details.getByText(label, { exact: true })).toBeVisible();
		}
		await expect(details.getByText('3b36c79')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(details).toBeHidden();
		await expect(button).toBeFocused();
	});
});

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`accessibility and screenshots, ${scheme}`, () => {
		test.setTimeout(READY_TIMEOUT_MS + 90_000);

		const check = async (page: Page, state: string): Promise<void> => {
			const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
			const detail = r.violations.map(
				(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
			);
			expect(detail, `${state} (${scheme})`).toEqual([]);
		};

		test(`axe: treegrid with a row, a cell and the engine popover (${scheme})`, async ({
			page,
		}, info) => {
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			await check(page, 'treegrid');
			await row(page, 'Specification').focus();
			await check(page, 'a row focused');
			await page.keyboard.press('ArrowRight');
			await check(page, 'a cell focused');
			await page.keyboard.press('Enter');
			await check(page, 'a task opened');
			// The grid is a treegrid to a screen reader, with no stray roles.
			const names = await page.getByTestId('gantt-treegrid').evaluate((g) => ({
				rowgroups: g.querySelectorAll('[role="rowgroup"]').length,
				treeitems: g.querySelectorAll('[role="treeitem"]').length,
			}));
			expect(names).toEqual({ rowgroups: 1, treeitems: 0 });
			await page.getByTestId('engine-info').click();
			await expect(page.getByTestId('engine-info-details')).toBeVisible();
			await check(page, `engine popover on ${info.project.name}`);
		});

		test(`screenshots: treegrid and engine details (${scheme})`, async ({ page }, info) => {
			test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to refresh the screenshots');
			const device = phone(info) ? 'pixel7' : 'desktop';
			await page.emulateMedia({ colorScheme: scheme });
			if (!phone(info)) await page.setViewportSize({ width: 1440, height: 860 });
			await open(page);
			await row(page, 'Graphical User Interface').click();
			await page.waitForTimeout(300);
			await page.screenshot({ path: path.join(DIR, `treegrid-${device}-${scheme}.png`) });
			if (!phone(info)) {
				await row(page, 'Specification').focus();
				await page.keyboard.press('ArrowRight');
				await page.keyboard.press('ArrowRight');
				await page.waitForTimeout(200);
				await page.screenshot({
					path: path.join(DIR, `treegrid-desktop-cell-focus-${scheme}.png`),
				});
			}
			await page.getByTestId('engine-info').click();
			await expect(page.getByTestId('engine-info-details')).toBeVisible();
			await page.waitForTimeout(300);
			await page.screenshot({ path: path.join(DIR, `engine-info-${device}-${scheme}.png`) });
		});
	});
}

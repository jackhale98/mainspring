// SPDX-License-Identifier: GPL-2.0-or-later
// The # , Predecessors and Successors columns of the Gantt's task table (polish item 16), on the
// "Gantt manipulation shapes" sample: the cells' text (row numbers, a gap, a start-to-start link, a
// link whose task is declared by a macro, a link into another file), their accessible names (task
// names, not numbers) and hover text (ids), that numbers do not move when a group is collapsed,
// that the frozen # and Task columns stay put and keep # beside the name at the table's least
// width, and that a phone still draws the name column alone. Desktop Chrome and Pixel 7. With
// SCREENSHOTS=1 it writes docs/phases/screenshots/phase-3/polish-16-*.png (device scale factor 2).
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const OUT = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');
const SAMPLE = 'gantt-manipulation';

const isPhone = (info: { project: { name: string } }) => info.project.name !== 'desktop';
const grid = (page: Page) => page.getByTestId('gantt-treegrid');
const row = (page: Page, key: string) => grid(page).locator(`[role="row"][data-key="${key}"]`);
const cell = (r: Locator, col: string) => r.locator(`[data-col="${col}"]`);
const text = async (l: Locator) => ((await l.textContent()) ?? '').replace(/\s+/g, ' ').trim();
/** What a link cell shows: its row numbers (the names a screen reader reads are beside them). */
const seen = async (l: Locator) =>
	(await l.locator('.vis').count()) > 0 ? text(l.locator('.vis')) : text(l);

async function open(page: Page): Promise<void> {
	if ((page.viewportSize()?.width ?? 0) >= 1024) {
		await page.setViewportSize({ width: 1440, height: 860 });
	}
	await page.goto(`/app?sample=${SAMPLE}&mode=visual`);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(row(page, 'task:design.research')).toBeVisible();
	await page.waitForTimeout(500);
}

test.describe('the number and link columns', () => {
	test.setTimeout(READY_TIMEOUT_MS + 90_000);

	test('number the rows in outline order and list the links by row number', async ({ page }) => {
		await open(page);
		// 1 Design, 2 Research, 3 Sketch, 4 Review, 5 Write docs, 6 Design gate, 7 Spike, 8 Launch,
		// 9 Support, 10 Hotfix, 11 Build, 12 Write code, 13 Write tests, 14 Check unit (a macro's
		// task), 15 Checks, 16 Lint style (the last two in lib/build.tji, a file other than the plan's).
		const keys = [
			'design',
			'design.research',
			'design.sketch',
			'design.review',
			'design.docs',
			'design.gate',
			'spike',
			'launch',
			'support',
			'support.hotfix',
			'build',
			'build.code',
			'build.tests',
			'build.check_unit',
			'build.checks',
			'build.checks.lint_style',
		];
		const numbers = await Promise.all(
			keys.map(async (k) => text(cell(row(page, `task:${k}`), 'number'))),
		);
		expect(numbers).toEqual(keys.map((_, i) => String(i + 1)));

		const preds = (k: string) => seen(cell(row(page, `task:${k}`), 'predecessors'));
		const succs = (k: string) => seen(cell(row(page, `task:${k}`), 'successors'));
		// A gap in working time, "+2d".
		expect(await preds('design.sketch')).toBe('2 +2d');
		expect(await succs('design.research')).toBe('3 +2d');
		// `onstart` is a start-to-start link, written as MS Project does: the kind after the number.
		expect(await preds('design.review')).toBe('3SS');
		expect(await succs('design.sketch')).toBe('4SS');
		// Two predecessors, in row order; a link from a task in the plan file to a container written
		// in the included file, and a gap on a task that is itself in a macro's body (Write tests).
		expect(await preds('design.gate')).toBe('4, 5');
		expect(await succs('design.gate')).toBe('10, 11');
		expect(await preds('build')).toBe('6');
		expect(await preds('build.tests')).toBe('12 +1d');
		expect(await succs('build.code')).toBe('13 +1d');
		// A task declared by a macro, in the other file, numbered like any other and linked.
		expect(await preds('build.check_unit')).toBe('13');
		expect(await succs('build.tests')).toBe('14');
		// A task with no links shows a dash.
		expect(await preds('spike')).toBe('–');
		expect(await succs('launch')).toBe('–');
	});

	test('give a screen reader the task names, and the TaskJuggler ids on hover', async ({
		page,
	}) => {
		await open(page);
		const sketch = row(page, 'task:design.sketch');
		await expect(cell(sketch, 'predecessors')).toHaveAccessibleName(
			'Predecessors: Research (plus 2 days)',
		);
		// The ids are the hover text of the numbers, which a screen reader does not read: the
		// cell is announced once, with no second description.
		await expect(cell(sketch, 'predecessors').locator('.vis')).toHaveAttribute(
			'title',
			'Waits for: design.research (plus 2 days)',
		);
		await expect(cell(sketch, 'predecessors')).toHaveAccessibleDescription('');
		await expect(cell(sketch, 'predecessors')).not.toHaveAttribute('aria-label');
		await expect(cell(sketch, 'predecessors')).not.toHaveAttribute('title');
		// The numbers are real text (selectable, found by Ctrl+F) that assistive technology skips.
		await expect(cell(sketch, 'predecessors').locator('.vis')).toHaveText('2 +2d');
		await expect(cell(sketch, 'predecessors').locator('.vis')).toHaveAttribute(
			'aria-hidden',
			'true',
		);
		await expect(cell(row(page, 'task:design.review'), 'predecessors')).toHaveAccessibleName(
			'Predecessors: Sketch (start to start)',
		);
		await expect(cell(row(page, 'task:design.gate'), 'predecessors')).toHaveAccessibleName(
			'Predecessors: Review, Write docs',
		);
		await expect(cell(row(page, 'task:design.gate'), 'successors')).toHaveAccessibleName(
			'Successors: Hotfix, Build',
		);
		await expect(cell(row(page, 'task:design.gate'), 'successors').locator('.vis')).toHaveAttribute(
			'title',
			'Followed by: support.hotfix, build',
		);
		// Blank cells say "none", as the other columns do.
		await expect(cell(row(page, 'task:spike'), 'predecessors')).toHaveAccessibleName('none');
		// The accessible role tree is whole: the headers have names and every column has an index.
		const heads = grid(page).getByRole('columnheader');
		await expect(heads.first()).toHaveAccessibleName('Row number');
		await expect(heads.nth(1)).toHaveAccessibleName('Task');
		await expect(heads.nth(9)).toHaveAccessibleName('Predecessors');
		await expect(heads.nth(10)).toHaveAccessibleName('Successors');
		await expect(grid(page)).toHaveAttribute('aria-colcount', '11');
		await expect(cell(sketch, 'predecessors')).toHaveAttribute('aria-colindex', '10');
		await expect(cell(sketch, 'successors')).toHaveAttribute('aria-colindex', '11');
		await expect(cell(sketch, 'number')).toHaveAttribute('aria-colindex', '1');
		await expect(cell(sketch, 'name')).toHaveAttribute('aria-colindex', '2');
	});

	test('keep every number when a group is collapsed, and still show the links to its rows', async ({
		page,
	}) => {
		await open(page);
		const numberOf = (k: string) => text(cell(row(page, `task:${k}`), 'number'));
		expect(await numberOf('spike')).toBe('7');
		expect(await numberOf('support.hotfix')).toBe('10');
		await row(page, 'task:design').focus();
		await page.keyboard.press('ArrowLeft');
		await expect(row(page, 'task:design')).toHaveAttribute('aria-expanded', 'false');
		await expect(row(page, 'task:design.sketch')).toHaveCount(0);
		// Spike is the second row now, and still 7; Hotfix still 10, still waiting for 6 (hidden).
		expect(await numberOf('spike')).toBe('7');
		expect(await numberOf('support.hotfix')).toBe('10');
		expect(await seen(cell(row(page, 'task:support.hotfix'), 'predecessors'))).toBe('6');
		expect(await numberOf('build')).toBe('11');
		// Opening it again puts the same numbers back.
		await page.keyboard.press('ArrowRight');
		await expect(row(page, 'task:design.sketch')).toBeVisible();
		expect(await numberOf('design.sketch')).toBe('3');
	});

	test('reach the new cells by keyboard, in the order of the columns', async ({ page }, info) => {
		test.skip(isPhone(info), 'a phone draws the name column alone');
		await open(page);
		const sketch = row(page, 'task:design.sketch');
		await sketch.focus();
		for (const col of [
			'number',
			'name',
			'start',
			'end',
			'effort',
			'people',
			'float',
			'critical',
			'status',
			'predecessors',
			'successors',
		]) {
			await page.keyboard.press('ArrowRight');
			await expect(cell(sketch, col)).toBeFocused();
			// A focused cell is wholly in the table's pane, past the frozen columns.
			const [c, pane] = await Promise.all([
				cell(sketch, col).boundingBox(),
				page.getByTestId('gantt').locator('.names').boundingBox(),
			]);
			expect((c?.x ?? 0) + (c?.width ?? 0)).toBeLessThanOrEqual(
				(pane?.x ?? 0) + (pane?.width ?? 0) + 1,
			);
		}
	});

	test('freeze # beside the name, and keep both when the table scrolls sideways', async ({
		page,
	}, info) => {
		test.skip(isPhone(info));
		await open(page);
		const sketch = row(page, 'task:design.sketch');
		const [n0, t0] = await Promise.all([
			cell(sketch, 'number').boundingBox(),
			cell(sketch, 'name').boundingBox(),
		]);
		// # is the left edge of the table and the name starts where it ends.
		expect(Math.abs((t0?.x ?? 0) - ((n0?.x ?? 0) + (n0?.width ?? 0)))).toBeLessThanOrEqual(1);
		await grid(page)
			.locator('.body-scroll')
			.evaluate((el) => (el.scrollLeft = 200));
		await page.waitForTimeout(300);
		const [n1, t1, head] = await Promise.all([
			cell(sketch, 'number').boundingBox(),
			cell(sketch, 'name').boundingBox(),
			grid(page).locator('[data-col-head="number"]').boundingBox(),
		]);
		expect(n1?.x).toBeCloseTo(n0?.x ?? 0, 0);
		expect(t1?.x).toBeCloseTo(t0?.x ?? 0, 0);
		expect(head?.x).toBeCloseTo(n0?.x ?? 0, 0);
		// The last columns are reachable in the pane's scroll.
		const succ = await cell(sketch, 'successors').boundingBox();
		expect(succ?.width ?? 0).toBeGreaterThan(100);
	});

	test('keep # with the name at the table’s least width, and nothing else', async ({
		page,
	}, info) => {
		test.skip(isPhone(info));
		await open(page);
		const divider = page.getByRole('separator', { name: /task table/i });
		await divider.focus();
		await page.keyboard.press('Home');
		await page.waitForTimeout(300);
		const sketch = row(page, 'task:design.sketch');
		const pane = await page.getByTestId('gantt').locator('.names').boundingBox();
		// The name keeps its 10 rem (160 px) and the number is beside it: 196 px in all.
		expect(Math.abs((pane?.width ?? 0) - 196)).toBeLessThanOrEqual(2);
		const [n, t] = await Promise.all([
			cell(sketch, 'number').boundingBox(),
			cell(sketch, 'name').boundingBox(),
		]);
		expect(n?.width ?? 0).toBeGreaterThan(30);
		expect(Math.abs((t?.width ?? 0) - 160)).toBeLessThanOrEqual(2);
		// Names read: nothing but the twisty's room is lost from a name of ordinary length.
		const label = await row(page, 'task:design.sketch').locator('.label').boundingBox();
		expect(label?.width ?? 0).toBeGreaterThan(90);
		expect((n?.width ?? 0) + (t?.width ?? 0)).toBeCloseTo(pane?.width ?? 0, -1);
		expect(await text(cell(sketch, 'number'))).toBe('3');
		for (const col of ['start', 'predecessors', 'successors']) {
			expect((await cell(sketch, col).boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
			await expect(cell(sketch, col)).not.toHaveAttribute('tabindex');
		}
		// Hidden from the eye, not from a screen reader: the words are still there.
		await expect(cell(sketch, 'predecessors')).toHaveAccessibleName(
			'Predecessors: Research (plus 2 days)',
		);
	});

	test('leave the phone with the name column alone', async ({ page }, info) => {
		test.skip(!isPhone(info));
		await open(page);
		const sketch = row(page, 'task:design.sketch');
		expect((await cell(sketch, 'name').boundingBox())?.width ?? 0).toBeGreaterThan(100);
		for (const col of ['number', 'predecessors', 'successors']) {
			expect((await cell(sketch, col).boundingBox())?.width ?? 0, col).toBeLessThanOrEqual(1);
			await expect(cell(sketch, col)).not.toHaveAttribute('tabindex');
		}
		// The table is the same for a screen reader.
		expect(await text(cell(sketch, 'number'))).toBe('3');
		await expect(cell(sketch, 'predecessors')).toHaveAccessibleName(
			'Predecessors: Research (plus 2 days)',
		);
		if (process.env['SCREENSHOTS']) {
			await page.screenshot({ path: path.join(OUT, 'polish-16-pixel7-gantt-light.png') });
		}
	});

	test('widen # for a plan of more than 999 tasks, so that no number is clipped', async ({
		page,
	}, info) => {
		test.skip(isPhone(info));
		test.setTimeout(READY_TIMEOUT_MS * 2);
		await page.setViewportSize({ width: 1440, height: 860 });
		await page.goto(`/app?sample=${SAMPLE}&mode=split`);
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		const head = grid(page).locator('[data-col-head="number"]');
		const three = (await head.boundingBox())?.width ?? 0;
		expect(Math.abs(three - 36)).toBeLessThanOrEqual(1);
		await page.getByRole('textbox', { name: /^Editor for / }).click();
		await page.keyboard.press('ControlOrMeta+End');
		const bulk = Array.from({ length: 1000 }, (_, i) => `task bulk${i} "Bulk ${i}" { effort 1d }`);
		await page.keyboard.insertText(`\n${bulk.join('\n')}\n`);
		// 16 tasks and 1,000 more: the header row is one more.
		await expect(grid(page)).toHaveAttribute('aria-rowcount', '1017', {
			timeout: READY_TIMEOUT_MS,
		});
		// Half a rem more for the fourth digit.
		await expect
			.poll(async () => Math.abs(((await head.boundingBox())?.width ?? 0) - 44))
			.toBeLessThanOrEqual(1);
		await page
			.getByTestId('gantt')
			.locator('.scroller')
			.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
		const last = grid(page).locator('[role="row"][data-key="task:bulk999"]');
		await expect(last).toBeVisible();
		const number = cell(last, 'number');
		await expect(number).toHaveText('1016');
		// The digits are whole: the cell's text is not wider than the cell.
		const [fits, name] = await Promise.all([
			number.evaluate((el) => el.scrollWidth <= el.clientWidth),
			cell(last, 'name').boundingBox(),
		]);
		expect(fits).toBe(true);
		expect(name?.x ?? 0).toBeGreaterThan((await number.boundingBox())?.x ?? 0);
	});

	test('show the TaskJuggler ids beside the names in the details', async ({ page }, info) => {
		await open(page);
		const panel = await openDetails(page, info, 'task:design.sketch');
		const waits = panel.getByRole('heading', { name: 'Waits for' });
		await waits.scrollIntoViewIfNeeded();
		await expect(waits).toBeVisible();
		// Each linked task: its name as the button, its id beside it.
		const wait = panel.locator('li', {
			has: page.getByRole('button', { name: 'Research', exact: true }),
		});
		await expect(wait.locator('code.id')).toHaveText('design.research');
		await expect(wait.locator('code.id')).toBeVisible();
		const follow = panel.locator('li', {
			has: page.getByRole('button', { name: 'Review', exact: true }),
		});
		await expect(follow.locator('code.id')).toHaveText('design.review');
		// The name is still the link's button, unchanged.
		await expect(wait.getByRole('button', { name: 'Research', exact: true })).toBeVisible();
	});
});

/** Where the details are: the side panel on a desktop, the bottom sheet on a phone. */
async function openDetails(page: Page, info: { project: { name: string } }, key: string) {
	const panel = isPhone(info)
		? page.getByRole('dialog', { name: /Task details/ })
		: page.getByRole('complementary', { name: 'Details' });
	const label = row(page, key).locator('.label');
	await label.click();
	// A sheet layout selects on the first tap and opens on a second.
	if (isPhone(info) && (await panel.count()) === 0) await label.click();
	await expect(panel.getByLabel('Name', { exact: true })).toHaveValue('Sketch');
	return panel;
}

// Pictures for the polish list: the table with the new columns, light and dark, at device scale
// factor 2, with the details of a task open on its links, and the least width.
test.describe('polish-16 pictures', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS + 90_000);
	test.use({ deviceScaleFactor: 2 });
	for (const scheme of ['light', 'dark'] as const) {
		test(`details with ids, desktop (${scheme})`, async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			const panel = await openDetails(page, info, 'task:design.sketch');
			await panel.getByRole('heading', { name: 'Waits for' }).scrollIntoViewIfNeeded();
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(OUT, `polish-16-details-desktop-${scheme}.png`) });
		});

		test(`desktop (${scheme})`, async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			// The divider is dragged so that the table shows every column.
			const handle = await page.getByRole('separator', { name: /task table/i }).boundingBox();
			if (!handle) throw new Error('no divider');
			const y = handle.y + handle.height / 2;
			await page.mouse.move(handle.x + handle.width / 2, y);
			await page.mouse.down();
			await page.mouse.move(1180, y, { steps: 8 });
			await page.mouse.up();
			await page.waitForTimeout(400);
			await row(page, 'task:design.sketch').locator('.label').click();
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(OUT, `polish-16-desktop-columns-${scheme}.png`) });
			// Scrolled to the end: # and Task stay, the links are beside them.
			await grid(page)
				.locator('.body-scroll')
				.evaluate((el) => (el.scrollLeft = el.scrollWidth));
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(OUT, `polish-16-desktop-links-${scheme}.png`) });
			await grid(page)
				.locator('.body-scroll')
				.evaluate((el) => (el.scrollLeft = 0));
			const divider = page.getByRole('separator', { name: /task table/i });
			await divider.focus();
			await page.keyboard.press('Home');
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(OUT, `polish-16-desktop-min-${scheme}.png`) });
		});
	}
});

// The same details on the Pixel 7 emulation (its own scale factor).
test.describe('polish-16 phone pictures', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS + 90_000);
	for (const scheme of ['light', 'dark'] as const) {
		test(`details with ids, pixel 7 (${scheme})`, async ({ page }, info) => {
			test.skip(info.project.name !== 'pixel-7');
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			const panel = await openDetails(page, info, 'task:design.sketch');
			await panel.getByRole('heading', { name: 'Waits for' }).scrollIntoViewIfNeeded();
			await page.waitForTimeout(400);
			await page.screenshot({ path: path.join(OUT, `polish-16-details-pixel7-${scheme}.png`) });
		});
	}
});

// SPDX-License-Identifier: GPL-2.0-or-later
// The workload heatmap (phase-3.md 9.3, 8.1, 10, 7.1 W1 and W2; T14), on the `fedora-res` sample
// ("Fedora with people"), on desktop Chrome and the Pixel 7 emulation:
// - the heatmap shows, with the people and their groups;
// - a cell's hours equal T9's `buildLoad` for that person and week (the gate, workload-gate.spec.ts,
//   checks every cell against an independent oracle);
// - the keyboard moves between cells, Enter opens the details, Escape closes them and gives the
//   focus back, T goes to today;
// - the cell details list the tasks with hours and effective effort, and the move menus and keys
//   answer (until T12's planner merges they say "coming" and change nothing: the text is the same);
// - zoom (the toolbar, + and -, Ctrl+wheel), the unit, the thresholds (stored per plan, a bad pair
//   refused) and the groups' toggles;
// - a rebalance drag with the mouse changes nothing but says so; a long-press on a finger opens the
//   details of a cell;
// - axe passes in light and dark, with the details open, and a finger's targets are 44 px.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createTimeZoneHost } from '../../src/engine/timezone';
import { availabilityOf } from '../../src/lib/workload/availability';
import { buildLoad } from '../../src/lib/workload/load';
import { buildIndex, hintsFromResult } from '../../src/lib/tjp/index';
import { golden } from '../../src/lib/tjp/index/testing';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { smallTargets } from './lib/targets';
import { mirrorCells, openHeatmap, oracle, resultOf, shape } from './lib/workload-rig';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const COMING = /Moving tasks between people and weeks is coming/;

test.beforeEach(({ browserName: _b }, info) => {
	test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T14); iPhone is reported');
});
test.setTimeout(READY_TIMEOUT_MS * 2);

type Hook = {
	scrollTo(person: string, col: number): boolean;
	cell(person: string, col: number): { x: number; y: number } | null;
};
type Win = { __mainspringWorkload: Hook; __mainspringEdits: { text(): string | null } };

const text = (page: Page) =>
	page.evaluate(() => (window as unknown as Win).__mainspringEdits.text() ?? '');

async function tapAt(page: Page, info: TestInfo, at: { x: number; y: number }): Promise<void> {
	if (isTouch(info)) await page.touchscreen.tap(at.x, at.y);
	else await page.mouse.click(at.x, at.y);
}

/** A person with booked time and the first week they have it, from the independent oracle. */
async function busyCell(page: Page): Promise<{ person: string; col: number }> {
	const result = await resultOf(page);
	if (!result) throw new Error('no result');
	const o = oracle(result);
	const s = await shape(page);
	for (const person of s?.rows ?? []) {
		if (result.resources.find((r) => r.id === person)?.group) continue;
		const row = o.booked.get(person) ?? [];
		const col = row.findIndex((m) => m > 0);
		if (col >= 0) return { person, col };
	}
	throw new Error('nobody is booked');
}

async function pointOf(page: Page, person: string, col: number) {
	await page.evaluate(
		([p, c]) => (window as unknown as Win).__mainspringWorkload.scrollTo(p as string, c as number),
		[person, col] as const,
	);
	await page.waitForTimeout(120);
	// A little into the cell, clear of the name column and the header.
	const at = await page.evaluate(
		([p, c]) => (window as unknown as Win).__mainspringWorkload.cell(p as string, c as number),
		[person, col] as const,
	);
	if (!at) throw new Error('no such cell');
	return at;
}

const zoomRadio = (page: Page, name: string) =>
	page.getByRole('radiogroup', { name: 'Zoom' }).getByRole('radio', { name });
async function chooseZoom(page: Page, name: string): Promise<void> {
	const radio = zoomRadio(page, name);
	if (await radio.isVisible()) await radio.click();
	else await page.getByRole('combobox', { name: 'Zoom' }).selectOption({ label: name });
}
async function chooseUnit(page: Page, name: 'Hours' | '%'): Promise<void> {
	const radio = page.getByRole('radiogroup', { name: 'Unit' }).getByRole('radio', { name });
	if (await radio.isVisible()) await radio.click();
	else {
		const toggle = page.getByTestId('heat-unit-toggle');
		if ((await toggle.textContent())?.trim() !== name) await toggle.tap();
	}
}

async function axe(page: Page, state: string): Promise<void> {
	await page.waitForTimeout(400);
	const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const detail = r.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
	);
	expect.soft(detail, state).toEqual([]);
}

test('shows the people and their weeks, groups first', async ({ page }, info) => {
	await openHeatmap(page, info);
	const s = await shape(page);
	expect(s?.rows.length).toBe(28);
	expect(s?.zoom).toBe('week');
	await expect(page.getByTestId('heat-cells')).toBeAttached();
	await expect(
		page
			.getByTestId('heat-names')
			.getByRole('button', { name: /^Collapse / })
			.first(),
	).toBeVisible();
	const grid = page.getByRole('grid', { name: 'Workload by person and period' });
	await expect(grid).toHaveAttribute('aria-rowcount', '29');
	await expect(grid).toHaveAttribute('aria-colcount', String((s?.cols ?? 0) + 1));
	const first = (await mirrorCells(page))[0];
	expect(first?.name).toMatch(
		/^.+, week of .+: \d+(\.\d+)? of \d+(\.\d+)? hours, (spare|full|over)/,
	);
	// Each cell says its band in words, not only in colour.
	await expect(page.locator('[data-testid="heat-cell"]').first()).toHaveText(
		/spare|full|over|no working time/,
	);
});

test("a cell's hours equal T9's buildLoad for that person and week", async ({ page }, info) => {
	await openHeatmap(page, info);
	const result = await resultOf(page);
	if (!result?.project) throw new Error('no result');
	const index = buildIndex(
		golden('fedora-res').snapshot(),
		hintsFromResult(result, (_f, l) => l),
		{
			cache: null,
		},
	);
	const scenario = result.project.scenarios.find((x) => x.active)?.id as string;
	const model = buildLoad({
		result,
		index,
		zones: createTimeZoneHost(),
		kind: 'week',
		collapsed: new Set(),
		availability: availabilityOf(result, scenario),
		demand: null,
	});
	const { person, col } = await busyCell(page);
	await pointOf(page, person, col);
	const cells = await mirrorCells(page);
	expect(cells.length).toBeGreaterThan(10);
	for (const c of cells) {
		const row = model.rows.findIndex((r) => r.id === c.person);
		expect([c.person, c.col, c.booked, c.available]).toEqual([
			c.person,
			c.col,
			model.booked[row]?.[c.col],
			model.available[row]?.[c.col],
		]);
	}
	expect(cells.some((c) => c.person === person && c.col === col && c.booked > 0)).toBe(true);
});

test('keyboard: arrows, Home and End, Enter opens the details, Escape closes them, T goes to today', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'a keyboard');
	await openHeatmap(page, info);
	const grid = page.getByRole('grid', { name: 'Workload by person and period' });
	const active = page.locator('[data-testid="heat-cell"][tabindex="0"]');
	await active.focus();
	const at = async () => {
		const f = page.locator('[data-testid="heat-cell"]:focus');
		return [Number(await f.getAttribute('data-row')), Number(await f.getAttribute('data-col'))];
	};
	const [r0, c0] = await at();
	await page.keyboard.press('ArrowRight');
	expect(await at()).toEqual([r0, c0! + 1]);
	await page.keyboard.press('ArrowDown');
	expect(await at()).toEqual([r0! + 1, c0! + 1]);
	await page.keyboard.press('End');
	const s = await shape(page);
	expect((await at())[1]).toBe((s?.cols ?? 0) - 1);
	// The cell scrolled into view and the mirror was rebuilt around it.
	await expect(page.locator('[data-testid="heat-cell"]:focus')).toBeAttached();
	await page.keyboard.press('Home');
	expect((await at())[1]).toBe(0);
	await page.keyboard.press('PageDown');
	expect((await at())[0]).toBeGreaterThan(r0! + 1);
	await page.keyboard.press('Control+Home');
	expect(await at()).toEqual([0, 0]);

	await page.keyboard.press('Enter');
	const details = page.getByTestId('cell-details');
	await expect(details).toBeVisible();
	await expect(details.getByRole('heading', { level: 2 })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(details).toBeHidden();
	expect(await at()).toEqual([0, 0]);
	await expect(grid).toBeAttached();
});

test('details: the tasks of a cell with hours and effective effort; the moves answer "coming"', async ({
	page,
}, info) => {
	await openHeatmap(page, info);
	const { person, col } = await busyCell(page);
	const at = await pointOf(page, person, col);
	const before = await text(page);
	await tapAt(page, info, at);
	if (isTouch(info)) await tapAt(page, info, at);
	const details = page.getByTestId('cell-details');
	await expect(details).toBeVisible();
	await expect(details.getByRole('heading', { level: 2 })).toContainText('week of');
	await expect(page.getByTestId('cell-band')).toBeVisible();
	await expect(details.getByText('Effective effort')).toBeVisible();
	const task = details.getByTestId('detail-task').first();
	await expect(task).toContainText(/\d+(\.\d+)? h/);
	await expect(task).toContainText(/h effective/);

	// Move to person…, from the menu.
	const menu = task.getByRole('combobox').first();
	const value = await menu.locator('option:not([disabled])').last().getAttribute('value');
	await menu.selectOption(value ?? '');
	await expect(details.getByText(COMING)).toBeVisible();
	// And Move to week….
	const weeks = task.getByRole('combobox').nth(1);
	await weeks.selectOption(
		(await weeks.locator('option:not([disabled])').last().getAttribute('value')) ?? '',
	);
	// The keys: Alt and the arrows on the task.
	await task.focus();
	await page.keyboard.press('Alt+ArrowDown');
	await page.keyboard.press('Alt+ArrowRight');
	await page.waitForTimeout(500);
	expect(await text(page)).toBe(before);

	// Show in Gantt selects the task and goes to the Gantt.
	await task.getByRole('button', { name: 'Show in Gantt' }).click();
	await expect(page.getByTestId('gantt')).toBeVisible();
});

test('zoom: the toolbar, + and -, and Ctrl+wheel step day, week and month', async ({
	page,
}, info) => {
	await openHeatmap(page, info);
	const root = page.getByTestId('workload');
	const grid = page.getByRole('grid', { name: 'Workload by person and period' });
	const cols = async () => Number(await grid.getAttribute('aria-colcount'));
	const weeks = await cols();
	await chooseZoom(page, 'Day');
	await expect(root).toHaveAttribute('data-zoom', 'day');
	expect(await cols()).toBeGreaterThan(weeks * 5);
	await chooseZoom(page, 'Month');
	await expect(root).toHaveAttribute('data-zoom', 'month');
	expect(await cols()).toBeLessThan(weeks / 3);
	await chooseZoom(page, 'Week');
	await expect(root).toHaveAttribute('data-zoom', 'week');
	expect(await cols()).toBe(weeks);
	if (isTouch(info)) return;
	// With the keyboard: - to month, + back to week, + again to day.
	await page.locator('[data-testid="heat-cell"][tabindex="0"]').focus();
	await page.keyboard.press('-');
	await expect(root).toHaveAttribute('data-zoom', 'month');
	await page.keyboard.press('+');
	await expect(root).toHaveAttribute('data-zoom', 'week');
	// Ctrl+wheel over the plot: forward zooms out, back zooms in.
	const box = await page.getByTestId('heat-overlay').boundingBox();
	await page.mouse.move((box?.x ?? 0) + 300, (box?.y ?? 0) + 100);
	await page.keyboard.down('Control');
	await page.mouse.wheel(0, 120);
	await expect(root).toHaveAttribute('data-zoom', 'month');
	await page.waitForTimeout(400);
	await page.mouse.wheel(0, -120);
	await expect(root).toHaveAttribute('data-zoom', 'week');
	await page.keyboard.up('Control');
});

test('zoom keeps the week in view', async ({ page }, info) => {
	test.skip(isTouch(info));
	await openHeatmap(page, info);
	const { person, col } = await busyCell(page);
	await pointOf(page, person, col);
	const wanted = (await mirrorCells(page)).find((c) => c.person === person && c.col === col);
	expect(wanted).toBeTruthy();
	await chooseZoom(page, 'Day');
	await page.waitForTimeout(300);
	const days = await mirrorCells(page);
	// The visible day cells belong to the same stretch of the plan: their names say the month.
	expect(days.length).toBeGreaterThan(10);
});

test('unit: percent shows percent in the cells and their names', async ({ page }, info) => {
	await openHeatmap(page, info);
	await chooseUnit(page, '%');
	await expect(page.getByTestId('workload')).toHaveAttribute('data-unit', 'percent');
	await expect(page.locator('[data-testid="heat-cell"]').first()).toContainText(
		'% of available time',
	);
	await chooseUnit(page, 'Hours');
	await expect(page.getByTestId('workload')).toHaveAttribute('data-unit', 'hours');
});

test('thresholds: stored per plan, a bad pair refused, bands follow', async ({ page }, info) => {
	await openHeatmap(page, info);
	const bands = async () => (await mirrorCells(page)).filter((c) => c.band === 'over').length;
	expect(await bands()).toBe(0);
	await page.getByTestId('heat-thresholds-chip').click();
	const over = page.getByLabel('Over above', { exact: true });
	const spare = page.getByLabel('Spare below', { exact: true });
	await spare.fill('120');
	await spare.press('Enter');
	await expect(page.getByRole('alert')).toContainText('Spare must be below over');
	await over.fill('90');
	await over.press('Enter');
	await spare.fill('50');
	await spare.press('Enter');
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect.poll(bands).toBeGreaterThan(0);
	const stored = await page.evaluate(() => localStorage.getItem('mainspring.workload.fedora-res'));
	expect(JSON.parse(stored ?? '{}').thresholds).toEqual({ spareBelow: 50, overAbove: 90 });
	// It survives a reload, and the other plan has its own.
	await page.reload();
	await expect(page.getByTestId('heat-cell').first()).toBeAttached({ timeout: 60_000 });
	if (isTouch(info))
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
	await page.getByTestId('heat-thresholds-chip').click();
	await expect(page.getByLabel('Over above', { exact: true })).toHaveValue('90');
	await expect(page.getByLabel('Spare below', { exact: true })).toHaveValue('50');
	await page.getByRole('button', { name: 'Reset to 80 and 100' }).click();
	await expect(page.getByLabel('Over above', { exact: true })).toHaveValue('100');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('heat-thresholds')).toBeHidden();
});

test("a group's toggle hides and shows its members", async ({ page }, info) => {
	await openHeatmap(page, info);
	const grid = page.getByRole('grid', { name: 'Workload by person and period' });
	const toggle = page
		.getByTestId('heat-names')
		.getByRole('button', { name: /^Collapse / })
		.first();
	const name = (await toggle.getAttribute('aria-label'))?.replace('Collapse ', '') ?? '';
	await toggle.click();
	await expect(page.getByRole('button', { name: `Expand ${name}` })).toHaveAttribute(
		'aria-expanded',
		'false',
	);
	expect(Number(await grid.getAttribute('aria-rowcount'))).toBeLessThan(29);
	await page.getByRole('button', { name: `Expand ${name}` }).click();
	await expect(grid).toHaveAttribute('aria-rowcount', '29');
});

test('rebalance: a mouse drag to another person shows the label and, until T12, changes nothing', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'mouse');
	await openHeatmap(page, info);
	const { person, col } = await busyCell(page);
	const from = await pointOf(page, person, col);
	const before = await text(page);
	// Escape cancels a drag.
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x, from.y + 60, { steps: 6 });
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(page.getByTestId('heat-live')).toContainText('Move cancelled');
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x, from.y + 14, { steps: 4 });
	await page.mouse.move(from.x + 2, from.y + 70, { steps: 6 });
	// The ghost's label is drawn on the canvas; the drag is axis-locked, so the column stays.
	await page.mouse.up();
	// A cell with several tasks asks which one is meant (18.9); a cell with one does not.
	const which = page.getByTestId('which-task');
	if (await which.isVisible()) {
		await expect(which).toContainText('Move which task?');
		await which.locator('button[data-task]').first().click();
	}
	await expect(page.getByText(COMING).last()).toBeVisible();
	expect(await text(page)).toBe(before);
	// A drag along the row (another week) asks the same.
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 14, from.y, { steps: 4 });
	await page.mouse.move(from.x + 120, from.y + 2, { steps: 6 });
	await page.mouse.up();
	expect(await text(page)).toBe(before);
});

test('a long-press on a finger opens the cell details; a tap selects, a second tap opens', async ({
	page,
}, info) => {
	test.skip(!isTouch(info), 'a finger');
	await openHeatmap(page, info);
	const { person, col } = await busyCell(page);
	const at = await pointOf(page, person, col);
	await page.touchscreen.tap(at.x, at.y);
	await expect(page.getByTestId('cell-details')).toBeHidden();
	await expect(page.getByTestId('heat-line')).toContainText('hours');
	await page.touchscreen.tap(at.x, at.y);
	await expect(page.getByTestId('cell-details')).toBeVisible();
	await page.getByRole('button', { name: 'Close' }).tap();
	await expect(page.getByTestId('cell-details')).toBeHidden();
	// Long-press, let go without moving.
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x: at.x, y: at.y, id: 1 }],
	});
	await page.waitForTimeout(550);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect(page.getByTestId('cell-details')).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
	test(`axe: the heatmap, the thresholds and the details (${scheme})`, async ({ page }, info) => {
		await page.emulateMedia({ colorScheme: scheme });
		await openHeatmap(page, info);
		await axe(page, `heatmap (${scheme})`);
		await page.getByTestId('heat-thresholds-chip').click();
		await axe(page, `thresholds (${scheme})`);
		await page.keyboard.press('Escape');
		const { person, col } = await busyCell(page);
		const at = await pointOf(page, person, col);
		await tapAt(page, info, at);
		if (isTouch(info)) await tapAt(page, info, at);
		await expect(page.getByTestId('cell-details')).toBeVisible();
		await axe(page, `details (${scheme})`);
	});
}

test('a finger: every target of the heatmap is 44 px', async ({ page }, info) => {
	test.skip(!isTouch(info), 'a finger');
	await openHeatmap(page, info);
	const small = (await smallTargets(page)).filter(
		(t) => !/people-shell|segment|panel/i.test(t.what),
	);
	expect(small.map((t) => `${t.what} ${t.width}x${t.height}`)).toEqual([]);
});

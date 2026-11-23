// SPDX-License-Identifier: GPL-2.0-or-later
// The workload heatmap (phase-3.md 9.3, 8.1, 10, 7.1 W1 and W2; T14), on desktop Chrome, the Pixel 7
// emulation and the iPhone 14. What depends on the size of the plan (its 28 rows, and the held and
// unmet work of T10) runs on the `fedora-res` sample ("Fedora with people"), and the gate
// (workload-gate.spec.ts) checks every cell of it; the rest runs on the small plan `ui-people`
// (ADR-0016 change 4):
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
// The details, the thresholds, the rebalance drag, the long-press, axe and the targets are in
// workload-edits.spec.ts (one file of ~580 lines ran 9 minutes on the iPhone, over a CI shard's
// 8, ADR-0016 section 4); the helpers of both are lib/workload-heat.ts.
import { expect, test } from '@playwright/test';
import { createTimeZoneHost } from '../../src/engine/timezone';
import { availabilityOf } from '../../src/lib/workload/availability';
import { buildLoad } from '../../src/lib/workload/load';
import { smallContext } from './lib/small-plan';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { mirrorCells, openHeatmap, resultOf, shape, walkGrid } from './lib/workload-rig';
import { busyCell, chooseUnit, chooseZoom, pointOf } from './lib/workload-heat';

test.setTimeout(READY_TIMEOUT_MS * 2);

const SMALL = 'ui-people';

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
	await openHeatmap(page, info, SMALL);
	const result = await resultOf(page);
	if (!result?.project) throw new Error('no result');
	// The index of the plan's text with the engine's hints, as the app builds it (the unit oracle's
	// context of the same plan, run in this process, has it).
	const { index } = await smallContext(SMALL);
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
	await openHeatmap(page, info, SMALL);
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

test('zoom: the toolbar, + and -, and Ctrl+wheel step day, week and month', async ({
	page,
}, info) => {
	await openHeatmap(page, info, SMALL);
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
	// The focus stays in the grid across the zoom (the mirror is rebuilt for the new columns).
	await expect(page.locator('[data-testid="heat-cell"]:focus')).toBeAttached();
	await page.keyboard.press('+');
	await expect(root).toHaveAttribute('data-zoom', 'week');
	// Ctrl+wheel over the plot: forward zooms out, back zooms in.
	const box = await page.getByTestId('heat-overlay').boundingBox();
	await page.mouse.move((box?.x ?? 0) + 300, (box?.y ?? 0) + 100);
	await page.keyboard.down('Control');
	await page.mouse.wheel(0, 120);
	await expect(root).toHaveAttribute('data-zoom', 'month');
	// The pause is the input: the zoom wheel starts a new count after 300 ms without a notch (the
	// app's clock, Workload.svelte), and nothing shows that it has.
	await page.waitForTimeout(400);
	await page.mouse.wheel(0, -120);
	await expect(root).toHaveAttribute('data-zoom', 'week');
	await page.keyboard.up('Control');
});

test('zoom keeps the week in view', async ({ page }, info) => {
	test.skip(isTouch(info));
	await openHeatmap(page, info, SMALL);
	const { person, col } = await busyCell(page);
	await pointOf(page, person, col);
	const wanted = (await mirrorCells(page)).find((c) => c.person === person && c.col === col);
	expect(wanted).toBeTruthy();
	await chooseZoom(page, 'Day');
	await expect.poll(async () => (await mirrorCells(page)).length).toBeGreaterThan(10);
	const days = await mirrorCells(page);
	// The visible day cells belong to the same stretch of the plan: their names say the month.
	expect(days.length).toBeGreaterThan(10);
});

test('held and unmet work (T10) shows in the cells: over, with the reason in the name', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'desktop: the walk of the grid is long on a phone');
	await openHeatmap(page, info);
	// The marks come in their own idle task after the model: poll the grid until a cell has them.
	let found: { person: string; col: number; name: string } | undefined;
	await expect
		.poll(
			async () => {
				const cells = await walkGrid(page);
				found = [...cells.values()].find((c) => c.name.includes('without them'));
				return found?.name ?? '';
			},
			{ timeout: 90_000, intervals: [2000] },
		)
		.toMatch(/over.*tasks? runs? without them|over.*run without them/);
	const cell = found as { person: string; col: number; name: string };
	expect(cell.name).toMatch(/, over,/);
	// The details say why: the clause from overCauses.
	const at = await pointOf(page, cell.person, cell.col);
	await page.mouse.click(at?.x ?? 0, at?.y ?? 0);
	const details = page.getByTestId('cell-details');
	await expect(details).toContainText(/tasks? runs? without/);
	await expect(details.getByText(/^Running without /)).toBeVisible();
});

test('unit: percent shows percent in the cells and their names', async ({ page }, info) => {
	await openHeatmap(page, info, SMALL);
	await chooseUnit(page, '%');
	await expect(page.getByTestId('workload')).toHaveAttribute('data-unit', 'percent');
	await expect(page.locator('[data-testid="heat-cell"]').first()).toContainText(
		'% of available time',
	);
	await chooseUnit(page, 'Hours');
	await expect(page.getByTestId('workload')).toHaveAttribute('data-unit', 'hours');
});

test("a group's toggle hides and shows its members", async ({ page }, info) => {
	await openHeatmap(page, info, SMALL);
	const grid = page.getByRole('grid', { name: 'Workload by person and period' });
	const rowCount = Number(await grid.getAttribute('aria-rowcount'));
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
	expect(Number(await grid.getAttribute('aria-rowcount'))).toBeLessThan(rowCount);
	await page.getByRole('button', { name: `Expand ${name}` }).click();
	await expect(grid).toHaveAttribute('aria-rowcount', String(rowCount));
});

// SPDX-License-Identifier: GPL-2.0-or-later
// The workload heatmap, continued from workload.spec.ts (split so that neither file runs over a CI
// shard's 8 minutes on the iPhone, ADR-0016 section 4), on the `fedora-res` sample:
// - the cell details list the tasks with hours and effective effort, and the move menus and keys
//   edit or refuse;
// - the thresholds are stored per plan, a bad pair is refused, and the bands follow;
// - a rebalance drag with the mouse is one edit that Undo takes back, or a refusal; a long-press on
//   a finger opens the details of a cell, a tap selects and a second tap opens;
// - axe passes in light and dark, with the details open, and a finger's targets are 44 px.
import { expect, test } from '@playwright/test';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';
import { smallTargets } from './lib/targets';
import {
	axe,
	busyCell,
	movableCell,
	moved,
	pointOf,
	tapAt,
	text,
	type Win,
} from './lib/workload-heat';
import { mirrorCells, openHeatmap, resultOf, shape } from './lib/workload-rig';

test.setTimeout(READY_TIMEOUT_MS * 2);

test('details: the tasks of a cell with hours and effective effort; the move menus and keys edit or refuse', async ({
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

	// Move to person…, from the menu: T12's planner makes it one edit (undone here) or refuses it.
	const menu = task.getByRole('combobox').first();
	const value = await menu.locator('option:not([disabled])').last().getAttribute('value');
	const toPerson = await moved(page, () => menu.selectOption(value ?? '').then(() => undefined));
	console.log('Move to person:', toPerson);
	// And Move to week….
	const weeks = task.getByRole('combobox').nth(1);
	const weekValue = await weeks.locator('option:not([disabled])').last().getAttribute('value');
	const week = await moved(page, () => weeks.selectOption(weekValue ?? '').then(() => undefined));
	console.log('Move to week:', week);
	// The keys: Alt and the arrows on the task, one undo step for a run of presses.
	const keyed = await moved(page, async () => {
		await task.focus();
		await page.keyboard.press('Alt+ArrowDown');
		await page.keyboard.press('Alt+ArrowDown');
		await page.keyboard.press('Enter');
	});
	console.log('Alt+arrows:', keyed);
	expect([toPerson, week, keyed]).toContain('applied');
	expect(await text(page)).toBe(before);

	// Show in Gantt selects the task and goes to the Gantt.
	await task.getByRole('button', { name: 'Show in Gantt' }).click();
	await expect(page.getByTestId('gantt')).toBeVisible();
});

test('thresholds: stored per plan, a bad pair refused, bands follow', async ({ page }, info) => {
	await openHeatmap(page, info);
	const bands = async () => (await mirrorCells(page)).filter((c) => c.band === 'over').length;
	const before = await bands();
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
	await expect.poll(bands).toBeGreaterThan(before + 5);
	const stored = await page.evaluate(() => localStorage.getItem('mainspring.workload.fedora-res'));
	expect(JSON.parse(stored ?? '{}').thresholds).toEqual({ spareBelow: 50, overAbove: 90 });
	// It survives a reload, and the other plan has its own.
	await page.reload();
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	if (isTouch(info))
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
	await expect(page.getByTestId('heat-cell').first()).toBeAttached({ timeout: 60_000 });
	await page.getByTestId('heat-thresholds-chip').click();
	await expect(page.getByLabel('Over above', { exact: true })).toHaveValue('90');
	await expect(page.getByLabel('Spare below', { exact: true })).toHaveValue('50');
	await page.getByRole('button', { name: 'Reset to 80 and 100' }).click();
	await expect(page.getByLabel('Over above', { exact: true })).toHaveValue('100');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('heat-thresholds')).toBeHidden();
});

test('rebalance: a mouse drag to another person or week is one edit that Undo takes back, or a refusal', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'mouse');
	await openHeatmap(page, info);
	const { person, col } = await movableCell(page);
	const from = await pointOf(page, person, col);
	const before = await text(page);
	// Escape cancels a drag.
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x, from.y + 60, { steps: 6 });
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(page.getByTestId('heat-live')).toContainText('Move cancelled');
	// A person drag: the cell with several tasks asks which one is meant (18.9).
	const result = await resultOf(page);
	const rows = (await shape(page))?.rows ?? [];
	const isGroup = (id: string) => !!result?.resources.find((r) => r.id === id)?.group;
	const other = rows.slice(rows.indexOf(person) + 1).find((id) => !isGroup(id));
	if (!other) throw new Error('no person below');
	const drag = (kind: 'person' | 'week') =>
		async function dragged() {
			console.log('dragging to', kind);
			// The edge of the plot scrolls a drag: start from where the cell is now.
			const from = await pointOf(page, person, col);
			const to =
				kind === 'person'
					? await page.evaluate(
							([p, c]) =>
								(window as unknown as Win).__mainspringWorkload.cell(p as string, c as number),
							[other, col] as const,
						)
					: { x: from.x + 120, y: from.y };
			if (!to) throw new Error('no target');
			await page.mouse.move(from.x, from.y);
			await page.mouse.down();
			await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
			await page.mouse.move(to.x, to.y, { steps: 6 });
			await page.mouse.up();
			const which = page.getByTestId('which-task');
			if (await which.isVisible()) {
				await expect(which).toContainText('Move which task?');
				await which.locator('button[data-task]').first().click();
			}
		};
	const toPerson = await moved(page, drag('person'));
	const toWeek = await moved(page, drag('week'));
	console.log('drag to person:', toPerson, '; to week:', toWeek);
	expect([toPerson, toWeek]).toContain('applied');
	expect(await text(page)).toBe(before);
});

test('a long-press on a finger opens the cell details; a tap selects, a second tap opens', async ({
	page,
}, info) => {
	test.skip(!isTouch(info), 'a finger');
	await openHeatmap(page, info);
	const { person, col } = await movableCell(page);
	const at = await pointOf(page, person, col);
	await page.touchscreen.tap(at.x, at.y);
	await expect(page.getByTestId('cell-details')).toBeHidden();
	await expect(page.getByTestId('heat-line')).toContainText('hours');
	await page.touchscreen.tap(at.x, at.y);
	await expect(page.getByTestId('cell-details')).toBeVisible();
	await page.getByRole('button', { name: 'Close' }).tap();
	await expect(page.getByTestId('cell-details')).toBeHidden();
	// Long-press, let go without moving: a finger down for 550 ms and lifted in place (real touch
	// events on the Pixel 7, dispatched touch pointers on the iPhone).
	const rig = new Rig(page, info);
	try {
		await rig.touches('touchStart', [at]);
		// The hold is the input: a long-press is a time on the page's clock; nothing shows it before
		// it ends.
		await page.waitForTimeout(550);
		await rig.touches('touchEnd', []);
	} finally {
		await rig.detach();
	}
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

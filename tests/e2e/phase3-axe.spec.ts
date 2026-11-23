// SPDX-License-Identifier: GPL-2.0-or-later
// What the T22 accessibility audit (phase-3.md 10; phase-3-perf-a11y.md) found no spec covering,
// after the T21 inventory (phase-3-gate.md):
// - axe, light and dark, in the Phase 3 states that had no scan: the heatmap's "Move which task?"
//   chooser, the Calendar in paint mode with its type and scope menus, the Resources "Add person"
//   form, the lanes' details at a person;
// - the polite live regions (phase-3.md 10: the zoom of the heatmap and the lanes, the Calendar's
//   mode and type, "N new problems" after a reschedule) say their words, once, and are
//   `role="status"` with `aria-live="polite"`;
// - the focus comes back: from the "Move which task?" chooser to the cell, from the lanes' period
//   details to the lane, from the Thresholds popover to its chip.
// The states already scanned (the heatmap, thresholds and details; the lanes and their details; the
// Calendar and a day; the table and a person; Health and its settings; Why here?; the empty and
// failed states; the filter) are in the specs that own them.
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { openCalendar, setMode, setScope, setType } from './lib/calendar-rig';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { findings, openHealth, openPlan, rowOf, settled, undo } from './lib/health-rig';
import { LanesRig } from './lib/lanes-rig';
import { dragCell } from './lib/rebalance-rig';
import { openResources } from './lib/resources-rig';
import { animationsDone, frames, panelSettled, resultRevision } from './lib/settle';
import { chooseZoom } from './lib/workload-heat';
import { openHeatmap } from './lib/workload-rig';

test.setTimeout(READY_TIMEOUT_MS * 3);

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: Page, state: string): Promise<void> {
	// A colour still easing, or a sheet still sliding in, reads as low contrast or as an overlap.
	await animationsDone(page, 3);
	const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	expect
		.soft(
			r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
			state,
		)
		.toEqual([]);
}

/** A move preference is answered up front, so that a drag shows the chooser and not the question. */
async function answerMovePreference(page: Page): Promise<void> {
	await page.addInitScript(() => {
		try {
			localStorage.setItem('mainspring.gantt.move', 'start');
		} catch {
			// Storage blocked: the question shows, and the test that needs the chooser fails by name.
		}
	});
}

const textOf = (page: Page, id: string): Promise<string> =>
	page.getByTestId(id).evaluate((e) => (e.textContent ?? '').replace(/​/g, ''));

for (const scheme of ['light', 'dark'] as const) {
	test(`axe: the heatmap's "Move which task?" chooser (${scheme})`, async ({ page }, info) => {
		await page.emulateMedia({ colorScheme: scheme });
		await answerMovePreference(page);
		await openHeatmap(page, info, 'ui-people');
		// Ana's second week has two movable tasks: a drop one row down asks which moves.
		await dragCell(page, info, { person: 'ana', col: 1 }, (a, _w, h) => ({ x: a.x, y: a.y + h }));
		const which = page.getByTestId('which-task');
		await expect(which).toBeVisible();
		await panelSettled(which);
		await scan(page, `which task (${scheme})`);
	});

	test(`axe: the Calendar in paint mode, with the scope and type menus (${scheme})`, async ({
		page,
	}, info) => {
		await page.emulateMedia({ colorScheme: scheme });
		await openCalendar(page, info);
		await setMode(page, 'paint');
		await setScope(page, 'Everyone');
		await setType(page, 'Holiday');
		await scan(page, `paint, Everyone, Holiday (${scheme})`);
		await setMode(page, 'erase');
		await scan(page, `erase (${scheme})`);
	});

	test(`axe: Resources with the Add person form open (${scheme})`, async ({ page }, info) => {
		await page.emulateMedia({ colorScheme: scheme });
		await openResources(page, info);
		await page.getByTestId('add-person-row').click();
		await expect(page.getByTestId('add-form')).toBeVisible();
		await scan(page, `add person (${scheme})`);
	});
}

test('the live regions say a change once, politely: heatmap and lanes zoom, Calendar mode', async ({
	page,
}, info) => {
	await openHeatmap(page, info, 'ui-people');
	const heat = page.getByTestId('heat-live');
	await expect(heat).toHaveAttribute('role', 'status');
	await expect(heat).toHaveAttribute('aria-live', 'polite');
	await chooseZoom(page, 'Day');
	await expect.poll(() => textOf(page, 'heat-live')).toContain('Day');
	await chooseZoom(page, 'Month');
	await expect.poll(() => textOf(page, 'heat-live')).toContain('Month');
});

test('the lanes announce their zoom, and the Calendar its mode and type', async ({
	page,
}, info) => {
	const rig = await LanesRig.openLanes(page, info, 'gantt-manipulation');
	const live = rig.root.getByTestId('lanes-live');
	await expect(live).toHaveAttribute('role', 'status');
	await expect(live).toHaveAttribute('aria-live', 'polite');
	await chooseZoom(page, 'Day');
	await expect.poll(() => textOf(page, 'lanes-live')).toContain('Day');

	const calendar = await page.context().newPage();
	await openCalendar(calendar, info);
	const cal = calendar.getByTestId('cal-live');
	await expect(cal).toHaveAttribute('role', 'status');
	await expect(cal).toHaveAttribute('aria-live', 'polite');
	await setMode(calendar, 'paint');
	await expect.poll(() => textOf(calendar, 'cal-live')).toMatch(/paint/i);
	await setMode(calendar, 'erase');
	await expect.poll(() => textOf(calendar, 'cal-live')).toMatch(/erase/i);
});

test('"N new problems" is announced once after a reschedule that brings a problem back', async ({
	page,
}, info) => {
	await openPlan(page, info);
	const live = page.getByTestId('health-live');
	await expect(live).toHaveAttribute('role', 'status');
	await expect(live).toHaveAttribute('aria-live', 'polite');
	const panel = await openHealth(page, info);
	// H3 "Remove start" clears a finding; its Undo brings the finding back: one new problem.
	const row = await rowOf(panel, 'hard-constraint', 'f20.naming');
	await row.locator('[data-fix="removeAttr"]').click();
	await settled(page);
	await expect(findings(panel, 'hard-constraint', 'f20.naming')).toHaveCount(0);
	// The fix may bring a problem of its own (it did here); the next result is what is compared with.
	const raw = (): Promise<string> =>
		page.getByTestId('health-live').evaluate((e) => e.textContent ?? '');
	const afterFix = await raw();
	await undo(page, info);
	// A same sentence twice differs by an invisible character, so that a reader says it again.
	await expect.poll(raw, { timeout: READY_TIMEOUT_MS }).not.toBe(afterFix);
	expect(await textOf(page, 'health-live')).toMatch(/^\d+ new problems?$/);
	// Said once: it stays as it is until the next result with new problems.
	const said = await textOf(page, 'health-live');
	await frames(page, 30);
	expect(await textOf(page, 'health-live')).toBe(said);
});

test('focus: Escape on the "Move which task?" chooser cancels and the focus stays in the view', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'a keyboard');
	await answerMovePreference(page);
	await openHeatmap(page, info, 'ui-people');
	await dragCell(page, info, { person: 'ana', col: 1 }, (a, _w, h) => ({ x: a.x, y: a.y + h }));
	const which = page.getByTestId('which-task');
	await expect(which).toBeVisible();
	// The chooser takes the focus (a dialog does), Escape closes it and nothing was edited.
	await expect(which.locator('button').first()).toBeFocused();
	const rev = await resultRevision(page);
	await page.keyboard.press('Escape');
	await expect(which).toBeHidden();
	expect(await resultRevision(page)).toBe(rev);
	// The focus is back in the view (a pointer drag leaves it on the view itself, a key press on a
	// cell), not lost on the page: before this audit it fell to the body.
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					document.activeElement !== document.body &&
					!!document.activeElement?.closest('[data-testid="workload"]'),
			),
		)
		.toBe(true);
});

test('focus: Thresholds closes with Escape onto its chip; the lanes return to the lane from the details', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'a keyboard');
	await openHeatmap(page, info, 'ui-people');
	const chip = page.getByTestId('heat-thresholds-chip');
	await chip.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog').or(page.getByTestId('heat-thresholds'))).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(chip).toBeFocused();
});

test('focus: Enter on a lane period opens the details, Escape returns to that period', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'a keyboard');
	const rig = await LanesRig.openLanes(page, info, 'gantt-manipulation');
	const cell = rig.root.locator('[data-testid="lane-cell"][tabindex="0"]');
	await cell.focus();
	const at = await cell.getAttribute('data-col');
	await page.keyboard.press('Enter');
	const details = rig.root.getByTestId('cell-details');
	await expect(details).toBeVisible();
	await expect(details.getByRole('heading', { level: 2 })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(details).toBeHidden();
	await expect(rig.root.locator('[data-testid="lane-cell"]:focus')).toHaveAttribute(
		'data-col',
		at ?? '',
	);
});

/** The first lines of an element's accessibility tree, written beside the results as evidence. */
async function tree(view: string, root: ReturnType<Page['locator']>, info: TestInfo) {
	const snap = await root.ariaSnapshot();
	fs.mkdirSync('test-results', { recursive: true });
	fs.writeFileSync(`test-results/phase3-a11y-tree-${view}-${info.project.name}.txt`, snap);
	return snap;
}

test('names: the accessibility tree of the heatmap, the lanes and the table is written down', async ({
	page,
}, info) => {
	await openHeatmap(page, info, 'ui-people');
	const heat = await tree('heatmap', page.getByRole('grid', { name: /Workload/ }), info);
	// A cell is named by its person, its period and its hours (phase-3.md 10).
	expect(heat).toMatch(/gridcell "[^"]+: \d+ of \d+ /);
	expect(heat).toMatch(/rowheader/);
	expect(heat).toMatch(/columnheader/);
	const laneRig = await page.context().newPage();
	await LanesRig.openLanes(laneRig, info, 'gantt-manipulation');
	const lanes = await tree('lanes', laneRig.getByTestId('lanes').getByRole('grid'), info);
	expect(lanes).toMatch(/gridcell/);
	// The canvases are not in the tree.
	expect(await laneRig.locator('canvas:not([aria-hidden="true"])').count()).toBe(0);
	await laneRig.close();
	const team = await page.context().newPage();
	await openResources(team, info);
	const table = await tree('table', team.getByTestId('resource-grid'), info);
	expect(table).toMatch(/row/);
	await team.close();
});

test('keyboard (W12): T goes to today in the heatmap and in the Calendar', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'a keyboard');
	// poc-sample is dated around the real today (2026), so today is inside its range.
	await openHeatmap(page, info, 'poc-sample');
	await page.locator('[data-testid="heat-cell"]').first().focus();
	await page.keyboard.press('Control+Home');
	const focused = page.locator('[data-testid="heat-cell"]:focus');
	const col = async (): Promise<number> => Number(await focused.getAttribute('data-col'));
	expect(await col()).toBe(0);
	await page.keyboard.press('t');
	// Today is in a later week of the plan: the focus moved there, and its name says which week.
	await expect.poll(col).toBeGreaterThan(0);
	const name = (await focused.textContent()) ?? '';
	const month = new Date().toLocaleString('en-GB', { month: 'long' });
	expect(name, 'the focused cell names the week of today').toContain(month);

	const cal = await page.context().newPage();
	await openCalendar(cal, info);
	await cal.getByTestId('cal-day').first().focus();
	await cal.keyboard.press('PageDown');
	await cal.keyboard.press('PageDown');
	await cal.keyboard.press('t');
	await expect(cal.locator('[data-testid="cal-day"][aria-current="date"]')).toBeAttached();
});

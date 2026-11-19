// SPDX-License-Identifier: GPL-2.0-or-later
// The part of phase-3.md 13.2's a11y bullet that no view's own spec covers (axe, 44 px targets and
// each view's keys are in workload-edits, lanes, calendar, resources, health, gantt-filter,
// people-shell, authoring and why-here; the T21 inventory in phase-3-gate.md maps them):
// - reduced motion in the People views: with `prefers-reduced-motion: reduce` nothing in the
//   heatmap, the lanes, the calendar or the team table animates or transitions (the same check as
//   the Gantt's, gantt-a11y.spec.ts), with the cell details open as well;
// - W10 by the keyboard: a health fix button takes the focus and Enter does the edit, which Undo
//   takes back byte for byte.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { findings, openHealth, openPlan, rowOf, settled, textOf } from './lib/health-rig';
import { animationsDone } from './lib/settle';
import { openHeatmap } from './lib/workload-rig';

test.setTimeout(READY_TIMEOUT_MS * 3);

/** Elements whose computed animation or transition lasts more than 50 ms. */
const moving = (page: Page): Promise<string[]> =>
	page.evaluate(() => {
		const out: string[] = [];
		const secs = (v: string): number =>
			Math.max(...v.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 0.001 : 1)));
		for (const el of document.querySelectorAll('body *')) {
			const cs = getComputedStyle(el);
			const anim = cs.animationName !== 'none' && secs(cs.animationDuration) > 0.05;
			const trans = secs(cs.transitionDuration) > 0.05;
			if (anim || trans) {
				out.push(
					`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ')[0]} ${anim ? `animation ${cs.animationName} ${cs.animationDuration}` : ''} ${trans ? `transition ${cs.transitionProperty} ${cs.transitionDuration}` : ''}`,
				);
			}
		}
		return out;
	});

/** Shows a People view: a desktop's switcher radio (or its menu), a phone's segment. */
async function showView(page: Page, info: TestInfo, view: 'Load' | 'Lanes' | 'Calendar' | 'Team') {
	if (isTouch(info)) {
		await page
			.getByRole('tablist', { name: 'People views' })
			.getByRole('tab', { name: view })
			.tap();
		return;
	}
	const name = { Load: 'Workload', Lanes: 'Resources', Calendar: 'Calendar', Team: 'Resources' }[
		view
	];
	const radio = page.getByRole('radiogroup', { name: 'Views' }).getByRole('radio', { name });
	if (await radio.isVisible()) await radio.click();
	else await page.getByRole('combobox', { name: 'Views' }).selectOption({ label: name });
}

test('reduced motion: nothing in the People views animates or transitions', async ({
	page,
}, info) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await openHeatmap(page, info, 'ui-people');
	await animationsDone(page, 3);
	expect.soft(await moving(page), 'the heatmap').toEqual([]);
	// The cell details (a sheet on a phone, a panel beside the heatmap on a desktop).
	const cell = page.getByTestId('heat-cell').first();
	await cell.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('cell-details')).toBeVisible();
	await animationsDone(page, 3);
	expect.soft(await moving(page), 'the cell details').toEqual([]);
	await page.getByTestId('cell-details').getByRole('button', { name: 'Close' }).first().click();
	for (const view of ['Lanes', 'Calendar', 'Team'] as const) {
		// A desktop has no separate Team view: its Resources view holds the table beside the lanes.
		if (view === 'Team' && !isTouch(info)) continue;
		await showView(page, info, view);
		await expect(page.getByTestId('people-host')).toHaveAttribute(
			'data-content',
			view === 'Lanes' ? 'resources' : view.toLowerCase(),
			{ timeout: READY_TIMEOUT_MS },
		);
		await animationsDone(page, 3);
		expect.soft(await moving(page), `the ${view} view`).toEqual([]);
	}
});

test('W10 by the keyboard: a health fix takes the focus, Enter edits, Undo restores the bytes', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'a keyboard');
	await openPlan(page, info);
	const panel = await openHealth(page, info);
	const start = await textOf(page);
	const row = await rowOf(panel, 'hard-constraint', 'f20.naming');
	const fix = row.locator('[data-fix="removeAttr"]');
	await fix.focus();
	await expect(fix).toBeFocused();
	await page.keyboard.press('Enter');
	await expect.poll(() => textOf(page), { timeout: 30_000 }).not.toBe(start);
	expect(await textOf(page)).toBe(start.replace('start 2013-09-17   # manually', '# manually'));
	await expect(findings(panel, 'hard-constraint', 'f20.naming')).toHaveCount(0, {
		timeout: READY_TIMEOUT_MS,
	});
	await settled(page);
	await page.getByTestId('toast').last().getByRole('button', { name: 'Undo' }).click();
	await expect.poll(() => textOf(page), { timeout: 30_000 }).toBe(start);
});

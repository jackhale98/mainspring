// SPDX-License-Identifier: GPL-2.0-or-later
// A <select> draws like the inputs beside it, with an arrow, in every browser (Base.astro): WebKit's
// native grey fill and white arrow are turned off (`appearance: none`) and the arrow is drawn as a
// background image. A component's own `background` or `padding` shorthand must not take it away
// (it did for the inspector's, the health panel's, the time zone's and the move menus' selects), so
// every visible select without `data-own-caret` that has `appearance: none` is checked for a
// non-`none` background image and room on its end for it, in each state that has one: the task
// details, the new-plan sheet, the calendar's day details, a heatmap cell's details, a health
// finding, and the file switcher. Desktop, Pixel 7 and iPhone 14; light and dark.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { openCalendar, showDay, tapDay } from './lib/calendar-rig';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { LICENSE_TASK, openHealthPanel } from './lib/select-states';
import { openHeatmap, oracle, resultOf, shape } from './lib/workload-rig';
import { ready } from './lib/sheet-rig';

test.setTimeout(READY_TIMEOUT_MS * 3);

interface Found {
	checked: number;
	bad: string[];
}

/** Every visible select that draws without the native look must have its arrow and the room for it. */
async function arrows(page: Page): Promise<Found> {
	return page.evaluate(() => {
		const bad: string[] = [];
		let checked = 0;
		for (const el of document.querySelectorAll<HTMLSelectElement>('select')) {
			if (el.hasAttribute('data-own-caret') || el.getClientRects().length === 0) continue;
			const cs = getComputedStyle(el);
			if (cs.appearance !== 'none') continue;
			checked++;
			const name = el.getAttribute('aria-label') ?? el.id ?? el.className;
			if (cs.backgroundImage === 'none') bad.push(`${name}: no arrow`);
			if (parseFloat(cs.paddingRight) < 24) bad.push(`${name}: padding-right ${cs.paddingRight}`);
		}
		return { checked, bad };
	});
}

async function expectArrows(page: Page, what: string): Promise<void> {
	const found = await arrows(page);
	expect(found.checked, `${what}: a select was found`).toBeGreaterThan(0);
	expect(found.bad, `${what}: every select has its arrow`).toEqual([]);
}

for (const scheme of ['dark', 'light'] as const) {
	test.describe(`selects have their arrow (${scheme})`, () => {
		test.beforeEach(async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
		});

		test('the task details', async ({ page }, info) => {
			await page.goto('/app?sample=gantt-manipulation&mode=visual&hooks=edits');
			await ready(page);
			const row = page
				.locator('[role="treegrid"] [role="row"][data-key]')
				.filter({ has: page.locator('[data-col="name"] .label', { hasText: 'Research' }) })
				.first();
			await expect(row).toBeVisible();
			await page.waitForTimeout(500);
			await row.click();
			const panel = isTouch(info)
				? page.getByRole('dialog', { name: /Task details/ })
				: page.getByTestId('inspector');
			if (isTouch(info) && (await panel.count()) === 0) await row.click();
			await expect(panel.getByLabel('Name', { exact: true })).toHaveValue('Research');
			await page.waitForTimeout(400);
			await expectArrows(page, 'task details');
		});

		test('the new-plan sheet (time zone)', async ({ page }) => {
			await page.goto('/app?sample=gantt-manipulation&mode=visual');
			await ready(page);
			await page.getByLabel('Sample plan').selectOption({ label: 'New plan…' });
			await expect(page.getByRole('dialog', { name: /New plan/ })).toBeVisible();
			await page.waitForTimeout(400);
			await expectArrows(page, 'new plan');
		});

		test('the calendar day details', async ({ page }, info) => {
			await openCalendar(page, info);
			const d = await showDay(page, '2026-11-20');
			// A click selects and opens the details; a finger's first tap selects and the second opens them.
			await tapDay(page, info, d);
			if (isTouch(info)) await tapDay(page, info, d);
			await expect(page.getByTestId('cal-details')).toBeVisible();
			await page.waitForTimeout(600);
			await expectArrows(page, 'day details');
		});

		test('a heatmap cell’s details (the move menus)', async ({ page }, info) => {
			await openHeatmap(page, info);
			const result = await resultOf(page);
			if (!result) throw new Error('no result');
			const o = oracle(result);
			const s = await shape(page);
			let target: { person: string; col: number } | null = null;
			for (const person of s?.rows ?? []) {
				if (result.resources.find((r) => r.id === person)?.group) continue;
				const col = (o.booked.get(person) ?? []).findIndex((m) => m > 0);
				if (col >= 0) {
					target = { person, col };
					break;
				}
			}
			if (!target) throw new Error('nobody is booked');
			type Hook = {
				scrollTo(p: string, c: number): boolean;
				cell(p: string, c: number): { x: number; y: number } | null;
			};
			const { person, col } = target;
			await page.evaluate(
				([p, c]) =>
					(window as unknown as { __mainspringWorkload: Hook }).__mainspringWorkload.scrollTo(
						p as string,
						c as number,
					),
				[person, col] as const,
			);
			await page.waitForTimeout(150);
			const at = await page.evaluate(
				([p, c]) =>
					(window as unknown as { __mainspringWorkload: Hook }).__mainspringWorkload.cell(
						p as string,
						c as number,
					),
				[person, col] as const,
			);
			if (!at) throw new Error('no cell');
			await tap(page, info, at);
			if (isTouch(info)) await tap(page, info, at);
			await expect(page.getByTestId('cell-details')).toBeVisible();
			await page.waitForTimeout(500);
			await expectArrows(page, 'cell details');
		});

		test('a health finding’s replace-person list', async ({ page }, info) => {
			const row = await openHealthPanel(page, info);
			await expect(row.locator('select[data-fix="replace-person"]')).toBeVisible();
			await expectArrows(page, `health finding ${LICENSE_TASK}`);
		});

		test('the file switcher (a phone: tabs elsewhere)', async ({ page }, info) => {
			test.skip(!isTouch(info), 'a select only on a phone; tablets and desktops have tabs');
			await page.goto('/app?sample=syn-18-structure-include-macro&mode=text');
			await ready(page);
			if (isTouch(info)) await page.getByRole('tab', { name: 'Text', exact: true }).tap();
			await expect(page.locator('select').first()).toBeVisible();
			await expectArrows(page, 'file switcher');
		});
	});
}

async function tap(page: Page, info: TestInfo, at: { x: number; y: number }): Promise<void> {
	if (isTouch(info)) await page.touchscreen.tap(at.x, at.y);
	else await page.mouse.click(at.x, at.y);
}

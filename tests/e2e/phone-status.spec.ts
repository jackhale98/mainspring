// SPDX-License-Identifier: GPL-2.0-or-later
// The phone's status button (polish 8, "use the phone screen better"): the footer is gone, the
// plan's state is one button in the top bar, and its popover holds what the strip's controls did
// (next problem, Try again, New version · Reload) above the engine details. The hidden "Plan
// status" group keeps the runs spoken and has no focusable controls. Desktop keeps its footer.
// Screenshots (SCREENSHOTS=1) go to docs/phases/screenshots/phase-2/phone-status-*.png.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join('docs', 'phases', 'screenshots', 'phase-2');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
/** Warnings only: the second task cannot end by its `maxend`. */
const WARNINGS =
	'project p "P" 2026-01-05 +1m\nresource r "R"\ntask a "A" { effort 2d allocate r }\n' +
	'task b "B" { depends a effort 2d allocate r maxend 2026-01-07 }\n';
/** A syntax error, so that the plan is not scheduled. */
const ERRORS = `${WARNINGS}}\n`;
/** A plan with no task: a message that has no place in the text. */
const UNPLACED = 'project p "P" 2026-01-05 +1m\n';

const editor = (page: Page) => page.getByRole('textbox', { name: /^Editor for / });
const status = (page: Page) => page.getByRole('button', { name: /^Plan status:/ });
const group = (page: Page) => page.getByRole('group', { name: 'Plan status' });
const details = (page: Page) => page.getByTestId('engine-info-details');

async function open(page: Page, mode: 'visual' | 'text' = 'visual'): Promise<void> {
	await page.goto(`/app?sample=upstream-tutorial&mode=${mode}`);
	await expect(group(page)).toContainText('Scheduled', { timeout: READY_TIMEOUT_MS });
}

/** Replaces the plan's text in the editor (phone: the Text tab). */
async function typePlan(page: Page, text: string): Promise<void> {
	await page.getByRole('tab', { name: 'Text', exact: true }).click();
	await editor(page).click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText(text);
}

async function shot(page: Page, name: string): Promise<void> {
	await page.waitForTimeout(300);
	await page.screenshot({ path: path.join(DIR, `phone-status-${name}.png`) });
}

async function axe(page: Page, state: string): Promise<void> {
	const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const detail = r.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
	);
	expect(detail, state).toEqual([]);
}

test.describe('the phone status button', () => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'desktop', 'phone layouts only');
	});

	test('the footer is gone, and the hidden group has no focusable control', async ({ page }) => {
		await open(page);
		await expect(page.getByText('Changes stay in this tab')).toHaveCount(0);
		await expect(page.locator('.footer')).toHaveCount(0);
		// The group is there for assistive technology only, and has nothing to tab to.
		const box = await group(page).boundingBox();
		expect(box?.width ?? 99).toBeLessThanOrEqual(2);
		expect(
			await group(page).evaluate((g) => g.querySelectorAll('button, a, input, [tabindex]').length),
		).toBe(0);
		await expect(group(page).locator('.state')).toHaveText('Scheduled');
		// The panels run down to the tab bar.
		const gap = await page.evaluate(() => {
			const panel = document.querySelector('#panel-gantt')?.getBoundingClientRect();
			const tabs = document.querySelector('.tabbar')?.getBoundingClientRect();
			return (tabs?.top ?? 0) - (panel?.bottom ?? 0);
		});
		expect(gap).toBeLessThanOrEqual(10);
	});

	test('with the footer gone the chart still keeps room for the details sheet', async ({
		page,
	}) => {
		await open(page);
		await page
			.getByTestId('gantt')
			.locator('[role="row"][data-key]')
			.filter({ hasText: 'Graphical User Interface' })
			.first()
			.click();
		const sheet = page.locator('dialog.sheet[open]');
		await expect(sheet).toBeVisible();
		// The sheet reports its settled height (not where it is drawn while it slides in), so the
		// chart's scroll range reaches past it: the last row can be scrolled clear above it.
		await expect
			.poll(
				async () =>
					page.evaluate(() => {
						const top =
							document.querySelector('dialog.sheet[open]')?.getBoundingClientRect().top ?? 0;
						const scroller = document.querySelector<HTMLElement>('#panel-gantt .scroller');
						if (!scroller) return Infinity;
						scroller.scrollTop = scroller.scrollHeight;
						const rows = [...document.querySelectorAll('#panel-gantt [role="row"][data-key]')];
						return (rows.at(-1)?.getBoundingClientRect().bottom ?? Infinity) - top;
					}),
				{ timeout: 5_000 },
			)
			.toBeLessThanOrEqual(1);
	});

	test('the button is 44 px, says the state, and opens a popover that is fully on screen', async ({
		page,
	}) => {
		await open(page);
		const button = status(page);
		await expect(button).toHaveAccessibleName(
			/^Plan status: Scheduled\. Engine and scheduler details$/,
		);
		await expect(button).toHaveAttribute('data-glyph', 'ok');
		const b = await button.boundingBox();
		expect(b?.width ?? 0).toBeGreaterThanOrEqual(44);
		expect(b?.height ?? 0).toBeGreaterThanOrEqual(44);

		await button.click();
		await expect(details(page)).toBeVisible();
		const view = page.viewportSize();
		const box = await details(page).boundingBox();
		expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
		expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
		expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(view?.width ?? 0);
		expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(view?.height ?? 0);
		// Every control in it is a 44 px target.
		const small = await details(page).evaluate((el) =>
			[...el.querySelectorAll('button, summary')]
				.map((c) => ({ t: c.textContent?.trim(), h: c.getBoundingClientRect().height }))
				.filter((c) => c.h < 43.5),
		);
		expect(small).toEqual([]);
		// The plan's status first, then the engine's details.
		await expect(details(page).getByText('Scheduled', { exact: true })).toBeVisible();
		await expect(details(page).getByText('Finish', { exact: true })).toBeVisible();
		await expect(details(page).getByText('Scheduler total', { exact: true })).toBeVisible();
		await expect(details(page).getByText('3b36c79')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(details(page)).toBeHidden();
		await expect(button).toBeFocused();
	});

	test('warnings show as a triangle and the counts go to the next problem on the Text tab', async ({
		page,
	}) => {
		await open(page);
		await typePlan(page, WARNINGS);
		await expect(group(page)).toContainText('1 warning', { timeout: READY_TIMEOUT_MS });
		const button = status(page);
		await expect(button).toHaveAccessibleName(
			/^Plan status: Scheduled, 1 warning\. Engine and scheduler details$/,
		);
		await expect(button).toHaveAttribute('data-glyph', 'warning');
		await page.getByRole('tab', { name: 'Gantt', exact: true }).click();
		await button.click();
		await details(page).getByTestId('next-problem').click();
		await expect(details(page)).toBeHidden();
		await expect(page.getByRole('tab', { name: 'Text', exact: true })).toHaveAttribute(
			'aria-selected',
			'true',
		);
	});

	test('errors show as a diamond; messages without a place list in the popover', async ({
		page,
	}) => {
		await open(page);
		await typePlan(page, ERRORS);
		await expect(status(page)).toHaveAttribute('data-glyph', 'error', {
			timeout: READY_TIMEOUT_MS,
		});
		await typePlan(page, UNPLACED);
		await expect(group(page)).toContainText('without a place', { timeout: READY_TIMEOUT_MS });
		await status(page).click();
		const summary = details(page).getByText(/message without a place|messages without a place/);
		await summary.click();
		await expect(details(page).getByRole('listitem').first()).toBeVisible();
	});

	test('a newer deployed build adds a pip, says so, and Reload reloads the page', async ({
		page,
	}) => {
		await page.route('**/version.json*', (route) =>
			route.fulfill({ json: { id: 'ffffffff-209912312359', builtAt: '2099-12-31T23:59:00Z' } }),
		);
		await page.goto('/app?sample=upstream-tutorial&mode=visual');
		await expect(group(page)).toContainText('Scheduled', { timeout: READY_TIMEOUT_MS });
		const button = status(page);
		await expect(button).toHaveAccessibleName(/A new version is available\./, { timeout: 10_000 });
		await expect(button.getByTestId('update-pip')).toBeVisible();
		await button.click();
		const reload = details(page).getByRole('button', { name: 'New version · Reload' });
		await expect(reload).toBeVisible();
		const box = await reload.boundingBox();
		expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
		const loaded = page.waitForEvent('load');
		await reload.click();
		await loaded;
		await expect(group(page)).toBeVisible({ timeout: READY_TIMEOUT_MS });
	});

	test('a scheduler that cannot start shows the diamond, the reason and Try again', async ({
		page,
	}) => {
		await page.route('**/engine/ruby*', (route) => route.abort());
		await page.goto('/app?sample=upstream-tutorial&mode=visual');
		await expect(status(page)).toHaveAttribute('data-glyph', 'error', {
			timeout: READY_TIMEOUT_MS,
		});
		await status(page).click();
		await expect(details(page).getByRole('button', { name: 'Try again' })).toBeVisible();
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`axe with the popover open (${scheme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			await axe(page, 'phone, status button closed');
			await status(page).click();
			await expect(details(page)).toBeVisible();
			await axe(page, `phone, status popover open (${scheme})`);
		});

		test(`screenshots (${scheme})`, async ({ page }) => {
			test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to refresh the screenshots');
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			await shot(page, `pixel7-gantt-${scheme}`);
			await page.getByRole('tab', { name: 'Text', exact: true }).click();
			await shot(page, `pixel7-text-${scheme}`);
			// Warnings and an unplaced message in one plan, popover open.
			await typePlan(page, WARNINGS);
			await expect(group(page)).toContainText('1 warning', { timeout: READY_TIMEOUT_MS });
			await page.getByRole('tab', { name: 'Gantt', exact: true }).click();
			await status(page).click();
			await expect(details(page)).toBeVisible();
			await shot(page, `pixel7-popover-warnings-${scheme}`);
			await page.keyboard.press('Escape');
			await typePlan(page, UNPLACED);
			await expect(group(page)).toContainText('without a place', { timeout: READY_TIMEOUT_MS });
			await status(page).click();
			await details(page)
				.getByText(/message without a place/)
				.click();
			await shot(page, `pixel7-popover-problems-${scheme}`);
		});

		test(`screenshots: new version and failure (${scheme})`, async ({ page }) => {
			test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to refresh the screenshots');
			await page.emulateMedia({ colorScheme: scheme });
			await page.route('**/version.json*', (route) =>
				route.fulfill({ json: { id: 'ffffffff-209912312359', builtAt: '2099-12-31T23:59:00Z' } }),
			);
			await open(page);
			await expect(status(page).getByTestId('update-pip')).toBeVisible({ timeout: 10_000 });
			await shot(page, `pixel7-gantt-update-${scheme}`);
			await status(page).click();
			await expect(details(page)).toBeVisible();
			await shot(page, `pixel7-popover-update-${scheme}`);
			// A scheduler that does not start.
			const failed = await page.context().newPage();
			await failed.emulateMedia({ colorScheme: scheme });
			await failed.route('**/engine/ruby*', (route) => route.abort());
			await failed.goto('/app?sample=upstream-tutorial&mode=visual');
			await expect(status(failed)).toHaveAttribute('data-glyph', 'error', {
				timeout: READY_TIMEOUT_MS,
			});
			await shot(failed, `pixel7-gantt-failed-${scheme}`);
			await status(failed).click();
			await expect(details(failed)).toBeVisible();
			await shot(failed, `pixel7-popover-failed-${scheme}`);
		});
	}
});

test.describe('desktop and tablet keep the strip', () => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	test('the footer, its notice and the engine button are still there', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop');
		await open(page);
		await expect(page.getByText('Changes stay in this tab until saving arrives')).toBeVisible();
		await expect(group(page).getByTestId('engine-info')).toBeVisible();
		await expect(page.getByTestId('status-button')).toHaveCount(0);
		await page.getByTestId('engine-info').click();
		await expect(details(page).getByText('Scheduler total', { exact: true })).toBeVisible();
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`desktop screenshots (${scheme})`, async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop' || !process.env['SCREENSHOTS']);
			await page.emulateMedia({ colorScheme: scheme });
			await page.setViewportSize({ width: 1440, height: 860 });
			await open(page);
			await shot(page, `desktop-gantt-${scheme}`);
			await page.getByTestId('engine-info').click();
			await expect(details(page)).toBeVisible();
			await shot(page, `desktop-engine-${scheme}`);
		});
	}
});

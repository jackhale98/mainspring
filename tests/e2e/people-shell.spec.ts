// SPDX-License-Identifier: GPL-2.0-or-later
// The People shell (phase-3.md 9.1, 9.6, 10, 18.10; T13), on desktop Chrome (the view switcher) and
// the Pixel 7 emulation (the phone's People tab with its segments):
// - switching views and segments, with the keyboard and by pointer;
// - the choice survives a reload, per plan;
// - the "No people" state on a New plan, and Add person writing the resource and selecting it;
// - the People chunk's script is not fetched by a Gantt-first load, and is when a People view opens
//   (Astro links the chunk's small stylesheet in the page head, as it does the editor's);
// - axe on every new state, light and dark, and 44 px targets on a finger.
// The screenshots are people-shell-screenshots.spec.ts.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { smallTargets } from './lib/targets';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(({ browserName: _b }, info) => {
	test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T13); iPhone is reported');
});
test.setTimeout(READY_TIMEOUT_MS * 2);

const PLAN = 'upstream-tutorial';

async function ready(page: Page): Promise<void> {
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText(
		/Scheduled|No tasks/,
		{
			timeout: READY_TIMEOUT_MS,
		},
	);
}

async function open(page: Page, query = ''): Promise<void> {
	await page.goto(`/app?sample=${PLAN}&mode=visual&hooks=edits${query}`);
	await ready(page);
}

const text = (page: Page) =>
	page.evaluate(
		() =>
			(
				window as unknown as { __mainspringEdits: { text(): string | null } }
			).__mainspringEdits.text() ?? '',
	);
const selection = (page: Page) =>
	page.evaluate(() =>
		(
			window as unknown as { __mainspringEdits: { selection(): unknown } }
		).__mainspringEdits.selection(),
	);

/** The switcher's tab (desktop) or the phone tab bar's People tab and its segment. */
const viewTab = (page: Page, name: string) =>
	page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name });
const segmentTab = (page: Page, name: string) =>
	page.getByRole('tablist', { name: 'People views' }).getByRole('tab', { name });
const peopleTab = (page: Page) =>
	page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' });

async function tap(touch: boolean, target: ReturnType<Page['locator']>): Promise<void> {
	if (touch) await target.tap();
	else await target.click();
}

/** Opens a plan made with "New plan…", which declares no resource. */
async function newPlan(page: Page, touch: boolean): Promise<void> {
	const sheet = page.getByRole('dialog', { name: 'New plan' });
	await page.getByLabel('Sample plan').selectOption({ label: 'New plan…' });
	await expect(sheet).toBeVisible();
	await sheet.getByLabel('Name', { exact: true }).fill('People plan');
	await tap(touch, sheet.getByRole('button', { name: 'Create' }));
	await expect(sheet).toBeHidden();
	await expect(page.getByLabel('Sample plan').locator('option:checked')).toHaveText(
		'People plan (new)',
	);
}

async function axe(page: Page, state: string): Promise<void> {
	await page.waitForTimeout(400);
	const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const detail = r.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
	);
	expect.soft(detail, state).toEqual([]);
}

test.describe('the view switcher (desktop and tablet)', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(isTouch(info), 'the phone has the People tab, below');
	});

	test('shows Gantt first, and switches views by click and by key, the focus staying on the tab', async ({
		page,
	}) => {
		await open(page);
		const tabs = page.getByRole('tablist', { name: 'Views' }).getByRole('tab');
		await expect(tabs).toHaveText(['Gantt', 'Workload', 'Resources', 'Calendar']);
		await expect(viewTab(page, 'Gantt')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('gantt')).toBeVisible();

		await viewTab(page, 'Workload').click();
		await expect(viewTab(page, 'Workload')).toHaveAttribute('aria-selected', 'true');
		const host = page.getByTestId('people-host');
		await expect(host).toHaveAttribute('data-content', 'workload', { timeout: READY_TIMEOUT_MS });
		await expect(page.getByTestId('gantt')).toBeHidden();
		await expect(page.getByTestId('people-coming')).toHaveText('The workload heatmap is coming.');
		// The panel is named by the tab, and the change was said once.
		await expect(page.getByRole('tabpanel', { name: 'Workload' })).toBeVisible();
		await expect(page.getByRole('status').filter({ hasText: 'Workload view' })).toHaveCount(1);

		// Arrow keys move and select; the focus follows. Roving tabindex: one tab stop.
		await viewTab(page, 'Workload').focus();
		await page.keyboard.press('ArrowRight');
		await expect(viewTab(page, 'Resources')).toBeFocused();
		await expect(host).toHaveAttribute('data-content', 'resources');
		await page.keyboard.press('End');
		await expect(viewTab(page, 'Calendar')).toBeFocused();
		await expect(host).toHaveAttribute('data-content', 'calendar');
		await page.keyboard.press('ArrowRight');
		await expect(viewTab(page, 'Gantt')).toBeFocused();
		await expect(page.getByTestId('gantt')).toBeVisible();
		await page.keyboard.press('ArrowLeft');
		await expect(viewTab(page, 'Calendar')).toBeFocused();
		await page.keyboard.press('Home');
		await expect(viewTab(page, 'Gantt')).toBeFocused();
		await expect(tabs.and(page.locator('[tabindex="0"]'))).toHaveCount(1);
		// Tab leaves the tablist for the view's content.
		await page.keyboard.press('Tab');
		await expect(viewTab(page, 'Gantt')).not.toBeFocused();
	});

	test('a tablet width has the switcher too, with 44 px targets on a finger', async ({
		browser,
	}) => {
		const context = await browser.newContext({
			viewport: { width: 820, height: 1000 },
			hasTouch: true,
		});
		const page = await context.newPage();
		await open(page);
		await expect(page.getByRole('tablist', { name: 'Panels' })).toHaveCount(0);
		await viewTab(page, 'Resources').tap();
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'resources', {
			timeout: READY_TIMEOUT_MS,
		});
		const small = (await smallTargets(page)).filter((t) => t.what.includes('tab'));
		expect(small).toEqual([]);
		await context.close();
	});

	test('remembers the view per plan across a reload', async ({ page }) => {
		await open(page);
		await viewTab(page, 'Resources').click();
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'resources', {
			timeout: READY_TIMEOUT_MS,
		});
		await page.reload();
		await ready(page);
		await expect(viewTab(page, 'Resources')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'resources', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByTestId('gantt')).toBeHidden();
		// Another plan has its own: the Gantt.
		await page.goto('/app?sample=poc-sample&mode=visual');
		await ready(page);
		await expect(viewTab(page, 'Gantt')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('gantt')).toBeVisible();
	});

	test('Split keeps the editor beside a People view, and Text has no switcher', async ({
		page,
	}) => {
		await page.goto(`/app?sample=${PLAN}&mode=split&view=calendar`);
		await ready(page);
		await expect(viewTab(page, 'Calendar')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'calendar', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.locator('#panel-text .cm-editor')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Text' }).click();
		await expect(page.getByTestId('view-switcher')).toBeHidden();
	});

	test('"No people" on a plan without resources: Add person writes the resource and selects it', async ({
		page,
	}) => {
		await open(page);
		await newPlan(page, false);
		await viewTab(page, 'Workload').click();
		const none = page.getByTestId('no-people');
		await expect(none).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(none).toContainText('No people yet');
		// Resources shows it too; the calendar needs no people (holidays are global).
		await viewTab(page, 'Resources').click();
		await expect(none).toBeVisible();
		await viewTab(page, 'Calendar').click();
		await expect(page.getByTestId('people-coming')).toBeVisible();
		await expect(none).toHaveCount(0);
		await viewTab(page, 'Workload').click();

		await page.getByTestId('add-person').click();
		await expect.poll(() => text(page)).toContain('resource new_person "New person"');
		await expect
			.poll(() => selection(page))
			.toEqual({
				kind: 'resource',
				id: 'new_person',
				origin: 'visual',
			});
		// The state goes with the first person; the focus is not dropped on the page.
		await expect(none).toHaveCount(0);
		await expect(page.getByTestId('people-coming')).toBeFocused();
		await expect(page.getByTestId('toast').filter({ hasText: 'Added New person' })).toBeVisible();
	});

	test('the Gantt-first load does not fetch the People chunk; opening a view does', async ({
		page,
	}) => {
		const chunks: string[] = [];
		page.on('request', (r) => {
			if (/PeopleHost[^/]*\.js(\?|$)/.test(r.url())) chunks.push(r.url());
		});
		await open(page);
		await expect(page.getByTestId('gantt')).toBeVisible();
		await page.waitForTimeout(1500);
		expect(chunks).toEqual([]);
		await viewTab(page, 'Workload').click();
		await expect(page.getByTestId('people-host')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		expect(chunks).toHaveLength(1);
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`axe: the switcher, a view, and "No people" (${scheme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			await axe(page, `Gantt with the switcher (${scheme})`);
			await viewTab(page, 'Workload').click();
			await expect(page.getByTestId('people-coming')).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await axe(page, `Workload (${scheme})`);
			await viewTab(page, 'Calendar').click();
			await axe(page, `Calendar (${scheme})`);
			await newPlan(page, false);
			await viewTab(page, 'Resources').click();
			await expect(page.getByTestId('no-people')).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await axe(page, `No people (${scheme})`);
		});
	}
});

test.describe('the phone People tab', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(!isTouch(info), 'the desktop has the view switcher, above');
	});

	test('has Plan, Gantt, People and Text; People has Load, Lanes, Calendar and Team', async ({
		page,
	}) => {
		await open(page);
		await expect(page.getByRole('tablist', { name: 'Panels' }).getByRole('tab')).toHaveText([
			'Plan',
			'Gantt',
			'People',
			'Text',
		]);
		await peopleTab(page).tap();
		await expect(peopleTab(page)).toHaveAttribute('aria-selected', 'true');
		const tabs = page.getByRole('tablist', { name: 'People views' }).getByRole('tab');
		await expect(tabs).toHaveText(['Load', 'Lanes', 'Calendar', 'Team']);
		await expect(segmentTab(page, 'Load')).toHaveAttribute('aria-selected', 'true');
		const host = page.getByTestId('people-host');
		await expect(host).toHaveAttribute('data-content', 'workload', { timeout: READY_TIMEOUT_MS });
		await expect(page.getByTestId('gantt')).toBeHidden();
		for (const [name, content] of [
			['Lanes', 'resources'],
			['Calendar', 'calendar'],
			['Team', 'team'],
			['Load', 'workload'],
		] as const) {
			await segmentTab(page, name).tap();
			await expect(segmentTab(page, name)).toHaveAttribute('aria-selected', 'true');
			await expect(host).toHaveAttribute('data-content', content);
		}
		// Back to the Gantt tab: the chart returns.
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'Gantt' }).tap();
		await expect(page.getByTestId('gantt')).toBeVisible();
	});

	test('remembers the segment per plan across a reload', async ({ page }) => {
		await open(page);
		await peopleTab(page).tap();
		await segmentTab(page, 'Team').tap();
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'team', {
			timeout: READY_TIMEOUT_MS,
		});
		await page.reload();
		await ready(page);
		await peopleTab(page).tap();
		await expect(segmentTab(page, 'Team')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'team', {
			timeout: READY_TIMEOUT_MS,
		});
	});

	test('"No people" on a New plan: Add person (+) writes the resource and selects it', async ({
		page,
	}) => {
		await open(page);
		await newPlan(page, true);
		await peopleTab(page).tap();
		const none = page.getByTestId('no-people');
		await expect(none).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(none).toContainText('No people yet');
		await page.getByTestId('add-person').tap();
		await expect.poll(() => text(page)).toContain('resource new_person "New person"');
		await expect.poll(() => selection(page)).toMatchObject({ kind: 'resource', id: 'new_person' });
		await expect(none).toHaveCount(0);
		await expect(page.getByTestId('people-coming')).toBeVisible();
	});

	test('the Gantt-first load does not fetch the People chunk; the People tab does', async ({
		page,
	}) => {
		const chunks: string[] = [];
		page.on('request', (r) => {
			if (/PeopleHost[^/]*\.js(\?|$)/.test(r.url())) chunks.push(r.url());
		});
		await open(page);
		await page.waitForTimeout(1500);
		expect(chunks).toEqual([]);
		await peopleTab(page).tap();
		await expect(page.getByTestId('people-host')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		expect(chunks).toHaveLength(1);
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`axe and 44 px targets: People tab, its segments and "No people" (${scheme})`, async ({
			page,
		}) => {
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			await peopleTab(page).tap();
			await expect(page.getByTestId('people-coming')).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await axe(page, `Load (${scheme})`);
			expect(await smallTargets(page)).toEqual([]);
			await segmentTab(page, 'Team').tap();
			await axe(page, `Team (${scheme})`);
			await newPlan(page, true);
			await peopleTab(page).tap();
			await expect(page.getByTestId('no-people')).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await axe(page, `No people (${scheme})`);
			expect(await smallTargets(page)).toEqual([]);
		});
	}
});

// SPDX-License-Identifier: GPL-2.0-or-later
// The People shell (phase-3.md 9.1, 9.6, 10, 18.10; T13), on desktop Chrome (the view switcher in
// the toolbar) and the Pixel 7 emulation (the phone's People tab with its segments):
// - switching views and segments, with the keyboard and by pointer; the focus follows the view;
// - the switcher fits the toolbar at 1280, 1024 and 820 px (one row, nothing clipped) and narrows;
// - the choice survives a reload, per plan; a new plan opens on the Gantt;
// - a People view stays mounted once seen;
// - the "No people" state on a New plan, and Add person writing the resource and selecting it;
// - the People chunk's script is not fetched by a Gantt-first load, and is when a People view
//   opens (Astro links the chunk's small stylesheet in the page head, as it does the editor's);
//   a chunk that cannot load shows the alert and "Try again" gets it;
// - the phone's segments do not overflow at 360 px;
// - axe on every new state, light and dark, and 44 px targets on a finger.
// The screenshots are people-shell-screenshots.spec.ts.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { reloadFromFailure, trackFailedChunks } from './lib/chunk-failure';
import { isWebKit } from './lib/finger';
import { animationsDone, appSettled, idleTurns } from './lib/settle';
import { smallTargets } from './lib/targets';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const CHUNK = /PeopleView[^/]*\.js(\?|$)/;

test.setTimeout(READY_TIMEOUT_MS * 2);

const PLAN = 'upstream-tutorial';

/** What a People view with people shows: the heatmap (Workload) or the lanes (Resources), else the resource table (T17). */
const content = (page: Page) =>
	page
		.locator(
			'[data-testid="resource-table"], [data-testid="calendar"], [data-testid="heat-cell"], [data-testid="workload"], [data-testid="lanes"]',
		)
		.first();

async function ready(page: Page): Promise<void> {
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText(
		/Scheduled|No tasks/,
		{ timeout: READY_TIMEOUT_MS },
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

/** The switcher's radio on a desktop or a tablet (the copy that is on screen), or the phone's tabs. */
const viewRadio = (page: Page, name: string) =>
	page.getByRole('radiogroup', { name: 'Views' }).getByRole('radio', { name });
const viewMenu = (page: Page) => page.getByRole('combobox', { name: 'Views' });
/**
 * Chooses a view with the switcher that is on screen: the radios where they fit the toolbar, the
 * menu button where they do not (ViewSwitcher.svelte has the tiers; a desktop at 1280 with the
 * details docked has the menu).
 */
async function chooseView(page: Page, name: string): Promise<void> {
	const radio = viewRadio(page, name);
	if (await radio.isVisible()) await radio.click();
	else await viewMenu(page).selectOption({ label: name });
}
/** Expects the view the switcher on screen shows as chosen. */
async function expectView(page: Page, name: string): Promise<void> {
	if (await viewMenu(page).isVisible()) {
		await expect(viewMenu(page)).toHaveValue(name.toLowerCase());
	} else await expect(viewRadio(page, name)).toBeChecked();
}
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
	await animationsDone(page, 3);
	const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const detail = r.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
	);
	expect.soft(detail, state).toEqual([]);
}

/** Holds the chunk's script (or fails it) until `release` (or `unroute`) is called. */
async function holdChunk(page: Page, mode: 'delay' | 'abort') {
	let release: () => void = () => undefined;
	const gate = new Promise<void>((r) => (release = r));
	await page.route(CHUNK, async (route) => {
		if (mode === 'abort') {
			await route.abort();
			return;
		}
		await gate;
		await route.continue();
	});
	return {
		release,
		unroute: () => page.unroute(CHUNK),
	};
}

test.describe('the view switcher (desktop and tablet)', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(isTouch(info), 'the phone has the People tab, below');
	});

	test('shows Gantt first, and switches views by click and by key, the focus following the view', async ({
		page,
	}) => {
		// Wide enough for the radios beside the Gantt's chips (the tiers of ViewSwitcher.svelte).
		await page.setViewportSize({ width: 1500, height: 800 });
		await open(page);
		const radios = page.getByRole('radiogroup', { name: 'Views' }).getByRole('radio');
		await expect(radios).toHaveText(['Gantt', 'Workload', 'Resources', 'Calendar']);
		await expect(viewRadio(page, 'Gantt')).toBeChecked();
		await expect(page.getByTestId('gantt')).toBeVisible();
		await expect(page.getByTestId('people-slot')).toHaveCount(0);

		// The Gantt's toolbar copy is pressed; the Gantt hides with it, and the focus follows the
		// choice to the copy in the People view's bar.
		await viewRadio(page, 'Workload').click();
		await expect(viewRadio(page, 'Workload')).toBeChecked();
		const host = page.getByTestId('people-host');
		await expect(host).toHaveAttribute('data-content', 'workload', { timeout: READY_TIMEOUT_MS });
		await expect(page.getByTestId('gantt')).toBeHidden();
		await expect(viewRadio(page, 'Workload')).toBeFocused();
		await expect(page.getByTestId('heat-cell').first()).toBeAttached({ timeout: READY_TIMEOUT_MS });

		// Arrow keys move and choose; the focus follows. Roving tabindex: one tab stop.
		await page.keyboard.press('ArrowRight');
		await expect(viewRadio(page, 'Resources')).toBeFocused();
		await expect(host).toHaveAttribute('data-content', 'resources');
		await page.keyboard.press('End');
		await expect(viewRadio(page, 'Calendar')).toBeFocused();
		await expect(host).toHaveAttribute('data-content', 'calendar');
		await page.keyboard.press('ArrowRight');
		await expect(viewRadio(page, 'Gantt')).toBeFocused();
		await expect(page.getByTestId('gantt')).toBeVisible();
		await page.keyboard.press('ArrowLeft');
		await expect(viewRadio(page, 'Calendar')).toBeFocused();
		await page.keyboard.press('Home');
		await expect(viewRadio(page, 'Gantt')).toBeFocused();
		await expect(radios.and(page.locator('[tabindex="0"]'))).toHaveCount(1);
		// Nothing announces the change but the chosen radio itself: no extra live region.
		await expect(
			page.locator('[data-view-switcher] [aria-live], [data-view-switcher] [role="status"]'),
		).toHaveCount(0);
	});

	test('keeps a People view mounted once seen: its element survives a trip to the Gantt', async ({
		page,
	}) => {
		await open(page);
		await chooseView(page, 'Resources');
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'resources', {
			timeout: READY_TIMEOUT_MS,
		});
		await page.getByTestId('people-slot').evaluate((el) => {
			(el as unknown as { __kept: boolean }).__kept = true;
		});
		await chooseView(page, 'Gantt');
		await expect(page.getByTestId('gantt')).toBeVisible();
		await expect(page.getByTestId('people-slot')).toBeHidden();
		await chooseView(page, 'Calendar');
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'calendar');
		expect(
			await page
				.getByTestId('people-slot')
				.evaluate((el) => (el as unknown as { __kept?: boolean }).__kept === true),
		).toBe(true);
	});

	for (const [name, width, height] of [
		['1500', 1500, 900],
		['1280', 1280, 720],
		['1024', 1024, 768],
		['820 (tablet)', 820, 1000],
	] as const) {
		test(`the switcher fits the Gantt's toolbar row at ${name}: one row, nothing clipped`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height });
			await open(page);
			const chips = page.getByRole('group', { name: 'Gantt controls' });
			// The radios, or the menu button where they do not fit (ViewSwitcher.svelte).
			const radios = page.getByRole('radiogroup', { name: 'Views' });
			const group = (await radios.isVisible()) ? radios : viewMenu(page);
			const add = page.getByTestId('add-task');
			const [c, g, a] = await Promise.all([
				chips.boundingBox(),
				group.boundingBox(),
				add.boundingBox(),
			]);
			if (!c || !g || !a) throw new Error('no boxes');
			// One row: the switcher and the Add task button share a line.
			expect(Math.abs(g.y + g.height / 2 - (a.y + a.height / 2))).toBeLessThan(6);
			// Nothing is cut off: every chip lies inside the chart panel, and the row does not scroll.
			const panel = await page.getByTestId('gantt').boundingBox();
			if (!panel) throw new Error('no panel');
			expect(c.x + c.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
			const overflow = await page
				.getByTestId('gantt')
				.evaluate(
					(el) =>
						(el.querySelector('.bar') as HTMLElement).scrollWidth -
						(el.querySelector('.bar') as HTMLElement).clientWidth,
				);
			expect(overflow).toBeLessThanOrEqual(0);
			// Whichever shows, it names every view.
			if (await radios.isVisible()) {
				await expect(radios.getByRole('radio')).toHaveText([
					'Gantt',
					'Workload',
					'Resources',
					'Calendar',
				]);
			} else {
				await expect(viewMenu(page).locator('option')).toHaveText([
					'Gantt',
					'Workload',
					'Resources',
					'Calendar',
				]);
			}
		});
	}

	test('with the details docked at 1280 the Gantt toolbar has the menu button; a People view has the radios', async ({
		page,
	}) => {
		// The Gantt's toolbar is about 940 px wide here: the chips keep their labels and the legend, so
		// four icons do not fit beside them (ViewSwitcher.svelte has the tiers). The Calendar has no
		// details dock and no chips, so its bar is wide enough for the icons (the Resources view docks
		// the person details since T17, so its bar is the Gantt's width again).
		await open(page);
		const menu = viewMenu(page);
		await expect(menu).toBeVisible();
		await expect(menu).toHaveValue('gantt');
		await expect(page.getByRole('radiogroup', { name: 'Views' })).toBeHidden();
		await menu.selectOption('calendar');
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'calendar', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(viewRadio(page, 'Calendar')).toBeChecked();
		await expect(viewRadio(page, 'Calendar')).toBeFocused();
		// Back to the Gantt by the radios: the Gantt's menu takes the focus.
		await viewRadio(page, 'Gantt').click();
		await expect(page.getByTestId('gantt')).toBeVisible();
		await expect(viewMenu(page)).toBeFocused();
		await expect(viewMenu(page)).toHaveValue('gantt');
	});

	test('Split keeps the editor beside a People view, and Text has no switcher', async ({
		page,
	}) => {
		await page.goto(`/app?sample=${PLAN}&mode=split&view=calendar`);
		await ready(page);
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'calendar', {
			timeout: READY_TIMEOUT_MS,
		});
		await expectView(page, 'Calendar');
		await expect(page.locator('#panel-text .cm-editor')).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});
		await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Text' }).click();
		await expect(page.getByTestId('people-slot')).toBeHidden();
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
		// A tablet's toolbar is under 1050 px: the switcher is the menu button there.
		await expect(viewMenu(page)).toBeVisible();
		await viewMenu(page).selectOption({ label: 'Resources' });
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'resources', {
			timeout: READY_TIMEOUT_MS,
		});
		const small = (await smallTargets(page)).filter(
			(t) => t.what.includes('radio') || t.what.includes('select'),
		);
		expect(small).toEqual([]);
		await context.close();
	});

	test('remembers the view per plan across a reload; a new plan opens on the Gantt', async ({
		page,
	}) => {
		await open(page);
		await chooseView(page, 'Resources');
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'resources', {
			timeout: READY_TIMEOUT_MS,
		});
		await page.reload();
		await ready(page);
		await expectView(page, 'Resources');
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'resources', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByTestId('gantt')).toBeHidden();
		// Another plan has its own: the Gantt.
		await page.goto('/app?sample=poc-sample&mode=visual');
		await ready(page);
		await expectView(page, 'Gantt');
		await expect(page.getByTestId('gantt')).toBeVisible();
		// A new plan always opens on the Gantt, whatever the shared `new` key was left with.
		await chooseView(page, 'Calendar');
		await newPlan(page, false);
		await expectView(page, 'Gantt');
		await expect(page.getByTestId('gantt')).toBeVisible();
		await chooseView(page, 'Resources');
		await expect(page.getByTestId('no-people')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await newPlan(page, false);
		await expectView(page, 'Gantt');
		await expect(page.getByTestId('gantt')).toBeVisible();
	});

	test('"No people" on a plan without resources: Add person writes the resource and selects it', async ({
		page,
	}) => {
		await open(page);
		await newPlan(page, false);
		await chooseView(page, 'Workload');
		const none = page.getByTestId('no-people');
		await expect(none).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(none).toContainText('No people yet');
		// Resources shows it too; the calendar needs no people (holidays are global).
		await chooseView(page, 'Resources');
		await expect(none).toBeVisible();
		await chooseView(page, 'Calendar');
		await expect(page.getByTestId('calendar')).toBeVisible();
		await expect(none).toHaveCount(0);
		await chooseView(page, 'Workload');

		await page.getByTestId('add-person').click();
		await expect.poll(() => text(page)).toContain('resource new_person "New person"');
		await expect
			.poll(() => selection(page))
			.toEqual({ kind: 'resource', id: 'new_person', origin: 'visual' });
		// The state goes with the first person; the focus is not dropped on the page.
		await expect(none).toHaveCount(0);
		await expect(
			page.locator('[data-testid="heat-cell"]:focus, [data-testid="workload"]:focus'),
		).toBeFocused();
		await expect(page.getByTestId('toast').filter({ hasText: 'Added New person' })).toBeVisible();
	});

	test('the Gantt-first load does not fetch the People chunk; opening a view does', async ({
		page,
	}) => {
		const chunks: string[] = [];
		page.on('request', (r) => {
			if (CHUNK.test(r.url())) chunks.push(r.url());
		});
		await open(page);
		await expect(page.getByTestId('gantt')).toBeVisible();
		// Nothing is fetched in the idle time that follows the first paint either: the app has settled
		// and its idle work has had its turns before the list is read.
		await appSettled(page);
		await idleTurns(page, 30);
		expect(chunks).toEqual([]);
		await chooseView(page, 'Workload');
		await expect(page.getByTestId('people-host')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		expect(chunks).toHaveLength(1);
	});

	// Playwright's bundled Chromium imports the chunk again on "Try again". Google Chrome (153, what
	// CHROMIUM_PATH=/usr/bin/google-chrome runs) remembers a failed dynamic import for the life of
	// the page and never asks the network again, so there the retry ends in "Reload the page", the
	// documented fallback (PeopleSlot.svelte). Checked on the T13 build and the T14 build alike: the
	// browser's behaviour, not the app's. Run this spec with the bundled Chromium (CI does).
	test('a chunk that cannot load shows the alert, and Try again gets it', async ({ page }) => {
		await open(page);
		const hold = await holdChunk(page, 'abort');
		await chooseView(page, 'Workload');
		const alert = page.getByTestId('people-failed');
		await expect(alert).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(alert).toContainText('The people views could not be loaded.');
		// The switcher is still there to go back, and a person can try again once the network is back.
		await expect(page.getByTestId('view-bar')).toBeVisible();
		await expectView(page, 'Workload');
		await hold.unroute();
		await alert.getByRole('button', { name: 'Try again' }).click();
		await expect(page.getByTestId('people-host')).toHaveAttribute('data-content', 'workload', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(alert).toHaveCount(0);
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`axe: the switcher, loading, failed, a view and "No people" (${scheme})`, async ({
			page,
		}) => {
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			await axe(page, `Gantt with the switcher (${scheme})`);
			// Loading: the chunk is held.
			const held = await holdChunk(page, 'delay');
			await chooseView(page, 'Workload');
			await expect(page.getByTestId('people-loading')).toBeVisible();
			await axe(page, `loading (${scheme})`);
			held.release();
			await expect(content(page)).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await held.unroute();
			await axe(page, `Workload (${scheme})`);
			await chooseView(page, 'Calendar');
			await axe(page, `Calendar (${scheme})`);
			// A narrow toolbar: the menu button.
			await page.setViewportSize({ width: 700, height: 800 });
			await axe(page, `menu button (${scheme})`);
			await page.setViewportSize({ width: 1280, height: 720 });
			await newPlan(page, false);
			await chooseView(page, 'Resources');
			await expect(page.getByTestId('no-people')).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await axe(page, `No people (${scheme})`);
		});
	}

	test('axe: a chunk that failed to load (light and dark)', async ({ page }) => {
		await open(page);
		await holdChunk(page, 'abort');
		await chooseView(page, 'Workload');
		await expect(page.getByTestId('people-failed')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await axe(page, `failed (${scheme})`);
		}
	});
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
		// Back to the Gantt tab: the chart returns; People is kept for later, hidden.
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'Gantt' }).tap();
		await expect(page.getByTestId('gantt')).toBeVisible();
		await expect(page.getByTestId('people-slot')).toBeHidden();
		// The phone has no view switcher.
		await expect(page.getByRole('radiogroup', { name: 'Views' })).toHaveCount(0);
		await expect(page.getByRole('combobox', { name: 'Views' })).toHaveCount(0);
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

	for (const [name, width] of [
		['360', 360],
		['390 (iPhone 14)', 390],
	] as const) {
		test(`no segment label overflows its segment at ${name}`, async ({ browser }) => {
			const context = await browser.newContext({
				viewport: { width, height: 780 },
				hasTouch: true,
				isMobile: true,
			});
			const page = await context.newPage();
			await open(page);
			await peopleTab(page).tap();
			await expect(content(page)).toBeVisible({ timeout: READY_TIMEOUT_MS });
			for (const seg of ['Load', 'Lanes', 'Calendar', 'Team']) {
				await segmentTab(page, seg).tap();
				const fits = await page.evaluate(() => {
					const list = document.querySelector('[role="tablist"][aria-label="People views"]');
					if (!list) return ['no list'];
					const lr = list.getBoundingClientRect();
					const bad: string[] = [];
					for (const b of list.querySelectorAll('[role="tab"]')) {
						const br = b.getBoundingClientRect();
						const label = b.querySelector('.label') as HTMLElement;
						const tr = label.getBoundingClientRect();
						const name = label.textContent ?? '';
						// The text lies inside its own segment, which lies inside the control.
						if (tr.left < br.left - 0.5 || tr.right > br.right + 0.5) bad.push(`${name} spills`);
						if (br.left < lr.left - 0.5 || br.right > lr.right + 0.5) bad.push(`${name} leaves`);
						if (label.scrollWidth > label.clientWidth + 1) bad.push(`${name} is cut`);
					}
					if (list.scrollWidth > list.clientWidth + 1) bad.push('the control scrolls');
					return bad;
				});
				expect(fits, `${seg} chosen at ${width}`).toEqual([]);
			}
			expect(await smallTargets(page)).toEqual([]);
			await context.close();
		});
	}

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
		await expect(content(page)).toBeVisible();
	});

	test('the Gantt-first load does not fetch the People chunk; the People tab does', async ({
		page,
	}) => {
		const chunks: string[] = [];
		page.on('request', (r) => {
			if (CHUNK.test(r.url())) chunks.push(r.url());
		});
		await open(page);
		await appSettled(page);
		await idleTurns(page, 30);
		expect(chunks).toEqual([]);
		await peopleTab(page).tap();
		await expect(page.getByTestId('people-host')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		expect(chunks).toHaveLength(1);
	});

	test('a chunk that cannot load shows the alert on the People tab, and Try again gets it', async ({
		page,
	}) => {
		await open(page);
		const hold = await holdChunk(page, 'abort');
		const failedUrls = trackFailedChunks(page, CHUNK);
		await peopleTab(page).tap();
		const alert = page.getByTestId('people-failed');
		await expect(alert).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await hold.unroute();
		await alert.getByRole('button', { name: 'Try again' }).tap();
		if (isWebKit(page)) {
			// WebKit remembers a failed import (as the slot's header says a browser may), so the
			// second try fails at once and the button becomes "Reload the page", which recovers.
			await expect(alert.getByRole('button', { name: 'Reload the page' })).toBeVisible();
			await expect(page.getByTestId('people-host')).toHaveCount(0);
			await reloadFromFailure(
				page,
				(b) => b.tap(),
				alert.getByRole('button', { name: 'Reload the page' }),
				failedUrls,
			);
			// A reload opens the phone on its first tab again.
			await ready(page);
			await peopleTab(page).tap();
		}
		await expect(page.getByTestId('people-host')).toBeVisible({ timeout: READY_TIMEOUT_MS });
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`axe and 44 px targets: People tab, its segments, loading, failed and "No people" (${scheme})`, async ({
			page,
		}) => {
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			const held = await holdChunk(page, 'delay');
			await peopleTab(page).tap();
			await expect(page.getByTestId('people-loading')).toBeVisible();
			await axe(page, `loading (${scheme})`);
			held.release();
			await expect(content(page)).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await held.unroute();
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

	test('axe: a chunk that failed to load (light and dark)', async ({ page }) => {
		await open(page);
		await holdChunk(page, 'abort');
		await peopleTab(page).tap();
		await expect(page.getByTestId('people-failed')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await axe(page, `failed (${scheme})`);
		}
	});
});

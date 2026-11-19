// SPDX-License-Identifier: GPL-2.0-or-later
// Predecessors and successors from the task details (polish item 11): "Waits for" and "Followed by"
// each have an Add button that opens a searchable task picker (an ARIA combobox). Covered: the
// picker is a lazy chunk (nothing fetched before Add), adding a predecessor and a successor by
// search with the exact text patch (a successor is `depends` written on the OTHER task), one undo
// step that restores the bytes, a loop refused with its toast and nothing changed, the tasks that
// can only be refused listed disabled with their reason, the keyboard-only path, axe in light and
// dark, and 44 px rows on a phone. Every assertion on the plan is on its text. With SCREENSHOTS=1
// it writes docs/phases/screenshots/phase-3/polish-11-*.png (desktop and Pixel 7, light and dark).
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { swipeOn } from './lib/finger';
import { animationsDone, appSettled, panelSettled, quietAfter } from './lib/settle';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

interface Hooks {
	text(path?: string): string | null;
	revision(): number | null;
}
type W = { __mainspringEdits: Hooks };
const text = (page: Page) => page.evaluate(() => (window as unknown as W).__mainspringEdits.text());
const revision = (page: Page) =>
	page.evaluate(() => (window as unknown as W).__mainspringEdits.revision());

const phone = (info: TestInfo) => info.project.name !== 'desktop';

async function open(page: Page): Promise<void> {
	await page.goto('/app?sample=gantt-manipulation&mode=visual&hooks=edits');
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.locator('[role="row"][data-key]').first()).toBeVisible();
	await expect.poll(() => revision(page)).not.toBeNull();
	await appSettled(page);
}

/** The details: the side panel on a desktop, the bottom sheet on a phone. */
const details = (page: Page, info: TestInfo): Locator =>
	phone(info)
		? page.getByRole('dialog', { name: /Task details|Link details/ })
		: page.getByRole('complementary', { name: 'Details' });

const row = (page: Page, name: string) =>
	page
		.locator('[role="treegrid"] [role="row"][data-key]')
		.filter({ has: page.locator('[data-col="name"] .label', { hasText: name }) })
		.first();

/** Selects a task row, as a click or a tap does (a sheet layout opens on a second tap). */
async function select(page: Page, info: TestInfo, name: string): Promise<Locator> {
	// The name cell: the middle of a wide row can be over the chart.
	await row(page, name).locator('[data-col="name"]').click();
	if (phone(info) && (await details(page, info).count()) === 0) {
		await expect(row(page, name)).toHaveAttribute('aria-selected', 'true');
		await row(page, name).locator('[data-col="name"]').click();
	}
	const panel = details(page, info);
	await expect(panel.getByLabel('Name', { exact: true })).toHaveValue(name);
	return panel;
}

const addWaitsFor = (panel: Locator) =>
	panel.getByRole('button', { name: 'Add a task this one waits for' });
/**
 * Press Add while the picker is open. On a phone the open picker holds itself at the top of the
 * sheet, which scrolls Add out of sight; the hold lets go when a finger presses or drags on the
 * sheet outside the picker (`pressed` and `dragged` in DependsPicker.svelte). So the test puts a
 * finger on the sheet's margin and drags it, as a person does (real touch on Pixel 7, the dispatched
 * events on iPhone 14: finger.ts), then brings Add into view. Playwright's own scroll into view is
 * not a person's, and the picker puts it back: in WebKit the press then hit the sheet's header.
 */
async function pressAddAgain(page: Page, panel: Locator): Promise<void> {
	const add = addWaitsFor(panel);
	if ((page.viewportSize()?.width ?? 1280) < 600) {
		await swipeOn(page, panel.locator('.content'));
		await panel
			.locator('.content')
			.evaluate((el) =>
				el.querySelector('[data-depends-add="predecessor"]')?.scrollIntoView({ block: 'center' }),
			);
		await expect(add).toBeInViewport({ ratio: 1 });
	}
	await add.click();
}
const addFollowedBy = (panel: Locator) =>
	panel.getByRole('button', { name: 'Add a task that follows this one' });
const searchFor = (page: Page, role: 'predecessor' | 'successor') =>
	page.getByRole('combobox', {
		name:
			role === 'predecessor'
				? 'Find a task this one waits for'
				: 'Find a task that follows this one',
	});
const options = (page: Page) => page.getByTestId('depends-picker').getByRole('option');
const optionFor = (page: Page, id: string) =>
	page.getByTestId('depends-picker').locator(`[role="option"][data-task="${id}"]`);

/**
 * The list is open. A mouse and a keyboard have the focus in the search box at once; a finger does
 * not (its keyboard would cover the list), and the first tap on the box takes it.
 */
async function expectOpen(page: Page, info: TestInfo, role: 'predecessor' | 'successor') {
	const search = searchFor(page, role);
	await expect(search).toBeVisible();
	if (!phone(info)) return expect(search).toBeFocused();
	await expect(search).not.toBeFocused();
	await search.tap();
	await expect(search).toBeFocused();
}

const allAnnounced = (page: Page) =>
	page.locator('[data-testid="toast"], [data-testid="toast-quiet"]');
const announced = (page: Page) => allAnnounced(page).last();
async function settled(page: Page): Promise<void> {
	await expect(announced(page)).toHaveAttribute('data-status', 'scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
}
/** Undo of the newest edit: the toast's button, or the top bar's on a phone. */
const undo = (page: Page) =>
	(page.viewportSize()?.width ?? 1280) < 600
		? page.getByTestId('undo').click()
		: page.getByTestId('toast').last().getByRole('button', { name: 'Undo' }).click();

test.describe('adding links from the details', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('the picker is a lazy chunk: fetched when Add is first pressed, not before', async ({
		page,
	}, info) => {
		const chunks: string[] = [];
		page.on('request', (r) => {
			// The script is the lazy part (its few rules of CSS come with the page's stylesheets).
			if (/DependsPicker.*\.js$/.test(r.url())) chunks.push(r.url());
		});
		await open(page);
		const panel = await select(page, info, 'Spike');
		await expect(addWaitsFor(panel)).toBeVisible();
		await expect(addFollowedBy(panel)).toBeVisible();
		expect(chunks).toEqual([]);
		await addWaitsFor(panel).click();
		await expectOpen(page, info, 'predecessor');
		expect(chunks).toHaveLength(1);
		// A second press and the other button use the chunk that is there.
		await pressAddAgain(page, panel);
		await expect(page.getByTestId('depends-picker')).toHaveCount(0);
		await addFollowedBy(panel).click();
		await expectOpen(page, info, 'successor');
		expect(chunks).toHaveLength(1);
	});

	test('adds a predecessor by search: one patch on the task, one undo step', async ({
		page,
	}, info) => {
		await open(page);
		const original = (await text(page)) ?? '';
		const panel = await select(page, info, 'Spike');
		await addWaitsFor(panel).click();
		const search = searchFor(page, 'predecessor');
		await expectOpen(page, info, 'predecessor');
		// Every other task is listed, with its dotted id and, below the top level, its outline path.
		await expect(optionFor(page, 'design.research')).toContainText('Research');
		await expect(optionFor(page, 'design.research')).toContainText('design.research');
		await expect(optionFor(page, 'design.research')).toContainText('Design');
		await expect(optionFor(page, 'spike')).toHaveCount(0);
		// By name (case does not matter) and by id.
		await search.fill('RESEARCH');
		await expect(options(page)).toHaveCount(1);
		await search.fill('design.res');
		await expect(options(page)).toHaveCount(1);
		await search.fill('design res');
		await expect(options(page)).toHaveCount(1);
		await optionFor(page, 'design.research').click();

		// Written on Spike, in its own block, where the canonical order puts it (before `allocate`):
		// `depends` with the absolute id.
		await expect(page.getByTestId('depends-picker')).toHaveCount(0);
		await expect
			.poll(() => text(page))
			.toBe(
				original.replace(
					'  start 2026-03-23\n  allocate dev3\n}',
					'  start 2026-03-23\n  depends design.research\n  allocate dev3\n}',
				),
			);
		await expect(allAnnounced(page)).toHaveCount(1);
		await expect(announced(page)).toContainText('Spike now depends on Research');
		await settled(page);
		// The link shows in the list, with the task's name and id, and the focus is back on Add.
		const waits = panel.locator('.deps li').filter({ hasText: 'design.research' });
		await expect(waits).toHaveCount(1);
		await expect(addWaitsFor(panel)).toBeFocused();

		await undo(page);
		await expect.poll(() => text(page)).toBe(original);
		await expect(waits).toHaveCount(0);
	});

	test('adds a successor by search: the patch is written on the other task', async ({
		page,
	}, info) => {
		await open(page);
		const original = (await text(page)) ?? '';
		const panel = await select(page, info, 'Research');
		await addFollowedBy(panel).click();
		await searchFor(page, 'successor').fill('review');
		await expect(options(page)).toHaveCount(1);
		await optionFor(page, 'design.review').click();

		// Research's block is untouched; Review is the one that waits, so the item is added to the
		// `depends` that Review already has, as the sibling `!research`.
		await expect
			.poll(() => text(page))
			.toBe(
				original.replace('depends !sketch { onstart }', 'depends !sketch { onstart }, !research'),
			);
		await expect(announced(page)).toContainText('Review now depends on Research');
		await settled(page);
		await expect(panel.locator('.deps li').filter({ hasText: 'design.review' })).toHaveCount(1);
		await expect(addFollowedBy(panel)).toBeFocused();
		await undo(page);
		await expect.poll(() => text(page)).toBe(original);
	});

	test('lists what can only be refused as disabled with its reason, and the arrows visit it', async ({
		page,
	}, info) => {
		test.skip(phone(info), 'the keyboard path');
		await open(page);
		const panel = await select(page, info, 'Research');
		await addWaitsFor(panel).click();
		const search = searchFor(page, 'predecessor');
		// Its container is listed but disabled, with the reason; so is a task already linked.
		await expect(optionFor(page, 'design')).toHaveAttribute('aria-disabled', 'true');
		await expect(optionFor(page, 'design')).toContainText('Contains this task');
		await expect(optionFor(page, 'design.research')).toHaveCount(0);
		await optionFor(page, 'design').click({ force: true });
		await expect(page.getByTestId('depends-picker')).toBeVisible();
		await expect(allAnnounced(page)).toHaveCount(0);
		// Typing the container's name finds it, still disabled, and Enter does nothing.
		await search.fill('design');
		await expect(search).not.toHaveAttribute('aria-activedescendant', /opt-design$/);
		const before = await text(page);
		await page.keyboard.press('Enter');
		expect(await text(page)).toBe(before);
		await search.fill('');
		// Sketch is the first task that can be chosen. The arrows visit the disabled ones too, so a
		// screen reader reads their reason (Up from Sketch is the container); Enter does nothing there.
		await expect(search).toHaveAttribute('aria-activedescendant', /opt-design\.sketch$/);
		await page.keyboard.press('ArrowUp');
		await expect(search).toHaveAttribute('aria-activedescendant', /opt-design$/);
		await expect(optionFor(page, 'design')).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Enter');
		expect(await text(page)).toBe(before);
		await expect(page.getByTestId('depends-picker')).toBeVisible();
		await page.keyboard.press('ArrowUp');
		const last = (await options(page).last().getAttribute('data-task')) ?? '';
		await expect(search).toHaveAttribute('aria-activedescendant', new RegExp(`opt-${last}$`));
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await expect(search).toHaveAttribute('aria-activedescendant', /opt-design\.sketch$/);
		await page.keyboard.press('Escape');
		await expect(addWaitsFor(panel)).toBeFocused();

		// Linked tasks too: Sketch waits for Research, so Sketch is a successor already.
		await addFollowedBy(panel).click();
		await expect(optionFor(page, 'design.sketch')).toHaveAttribute('aria-disabled', 'true');
		await expect(optionFor(page, 'design.sketch')).toContainText('Already linked');
	});

	test('a loop is refused with its toast and nothing changes; the list stays open', async ({
		page,
	}, info) => {
		await open(page);
		const original = (await text(page)) ?? '';
		const panel = await select(page, info, 'Design gate');
		await addWaitsFor(panel).click();
		await searchFor(page, 'predecessor').fill('hotfix');
		await optionFor(page, 'support.hotfix').click();
		// Hotfix waits for the gate, so the gate cannot wait for it.
		await expect(announced(page)).toContainText(
			'That would make the tasks depend on each other in a loop.',
		);
		expect(await text(page)).toBe(original);
		await expect(page.getByTestId('depends-picker')).toBeVisible();
		await expect(page.getByTestId('depends-picker').getByRole('status')).toContainText(
			'Not linked',
		);
		// Nothing was added to undo. Escape closes it (a finger presses Add again).
		if (phone(info)) await pressAddAgain(page, panel);
		else {
			await expect(searchFor(page, 'predecessor')).toBeFocused();
			await page.keyboard.press('Escape');
		}
		await expect(page.getByTestId('depends-picker')).toHaveCount(0);
		if (!phone(info)) await expect(addWaitsFor(panel)).toBeFocused();
		expect(await text(page)).toBe(original);
	});

	test('a link a container already makes is listed disabled, not offered', async ({
		page,
	}, info) => {
		await open(page);
		const original = (await text(page)) ?? '';
		// `task build { depends design.gate … }`: every task in Build waits for the gate, though the
		// links the details list for Write code leave it out (the build.tji file is the sample's).
		const panel = await select(page, info, 'Write code');
		await addWaitsFor(panel).click();
		await searchFor(page, 'predecessor').fill('gate');
		await expect(options(page)).toHaveCount(1);
		const gate = optionFor(page, 'design.gate');
		await expect(gate).toHaveAttribute('aria-disabled', 'true');
		await expect(gate).toContainText('Already linked through a container');
		// Every match is disabled, and the status says so rather than counting a task.
		await expect(page.getByTestId('depends-picker').getByRole('status')).toContainText(
			'cannot be chosen',
		);
		await gate.click({ force: true });
		await expect(allAnnounced(page)).toHaveCount(0);
		expect(await text(page)).toBe(original);
		// The other end: from the gate, Write code is already a follower (a fresh page: on a phone the
		// open sheet covers the gate's row).
		await open(page);
		const gatePanel = await select(page, info, 'Design gate');
		await addFollowedBy(gatePanel).click();
		await searchFor(page, 'successor').fill('write code');
		await expect(optionFor(page, 'build.code')).toHaveAttribute('aria-disabled', 'true');
		await expect(optionFor(page, 'build.code')).toContainText('through a container');
	});

	test('works with the keyboard alone', async ({ page }, info) => {
		test.skip(phone(info), 'the keyboard path');
		await open(page);
		const original = (await text(page)) ?? '';
		const panel = await select(page, info, 'Sketch');
		await addFollowedBy(panel).focus();
		await page.keyboard.press('Enter');
		const search = searchFor(page, 'successor');
		await expect(search).toBeFocused();
		await expect(addFollowedBy(panel)).toHaveAttribute('aria-expanded', 'true');
		await page.keyboard.type('design ga');
		await expect(options(page)).toHaveCount(1);
		await expect(search).toHaveAttribute('aria-activedescendant', /opt-design\.gate$/);
		await page.keyboard.press('Enter');
		// Written on Design gate (the successor), after its own `depends`.
		await expect
			.poll(() => text(page))
			.toBe(original.replace('depends !docs\n', 'depends !docs, !sketch\n'));
		await settled(page);
		await expect(addFollowedBy(panel)).toBeFocused();
		await expect(addFollowedBy(panel)).toHaveAttribute('aria-expanded', 'false');
		await undo(page);
		await expect.poll(() => text(page)).toBe(original);
		// Escape closes without choosing and gives the focus back.
		await addFollowedBy(panel).focus();
		await page.keyboard.press('Enter');
		await expect(search).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('depends-picker')).toHaveCount(0);
		await expect(addFollowedBy(panel)).toBeFocused();
		expect(await text(page)).toBe(original);
	});

	test('rows are comfortable to press: 44 px on a phone', async ({ page }, info) => {
		await open(page);
		const panel = await select(page, info, 'Spike');
		await addWaitsFor(panel).click();
		await expect(options(page).first()).toBeVisible();
		const heights = await options(page).evaluateAll((els) =>
			els.slice(0, 8).map((e) => e.getBoundingClientRect().height),
		);
		const least = phone(info) ? 44 : 32;
		for (const h of heights) expect(h).toBeGreaterThanOrEqual(least - 0.5);
		const button = await addWaitsFor(panel).boundingBox();
		expect(button?.height ?? 0).toBeGreaterThanOrEqual(least - 0.5);
		// On the phone the sheet is not pushed off the screen: the list can be reached and pressed.
		await optionFor(page, 'design.research').scrollIntoViewIfNeeded();
		await expect(optionFor(page, 'design.research')).toBeInViewport();
		await optionFor(page, 'design.research').click();
		await expect.poll(() => text(page)).toContain('depends design.research');
	});
});

test.describe('the dependency picker is accessible', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);

	for (const scheme of ['light', 'dark'] as const) {
		test(`axe passes with the picker open, ${scheme}`, async ({ page }, info) => {
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			const panel = await select(page, info, 'Research');
			await addFollowedBy(panel).click();
			await searchFor(page, 'successor').fill('s');
			await expect(options(page).first()).toBeVisible();
			// On a phone the sheet goes to its full height as the picker opens; axe measures target sizes
			// and overlaps, so it runs on the settled layout, not mid-slide (a slow runner read the
			// toolbar's Today button half covered by the sliding sheet).
			await panelSettled(panel);
			const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
			expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual(
				[],
			);
		});
	}
});

// Screenshots, desktop and Pixel 7, light and dark (CLAUDE.md "Mobile counts").
test.describe('dependency picker screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to refresh docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS * 2);

	for (const scheme of ['light', 'dark'] as const) {
		test(`the picker open and the link added, ${scheme}`, async ({ page }, info) => {
			if (!phone(info)) await page.setViewportSize({ width: 1440, height: 860 });
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			const shot = (name: string) =>
				page.screenshot({
					path: path.join(DIR, `polish-11-${name}-${info.project.name}-${scheme}.png`),
				});
			const panel = await select(page, info, 'Research');
			await addFollowedBy(panel).click();
			await searchFor(page, 'successor').fill('s');
			await expect(options(page).first()).toBeVisible();
			await options(page).first().scrollIntoViewIfNeeded();
			await animationsDone(page, 3);
			await shot('picker');
			await optionFor(page, 'design.review').click({ force: true });
			await quietAfter(page);
			await animationsDone(page, 3);
			await shot('added');
		});
	}
});

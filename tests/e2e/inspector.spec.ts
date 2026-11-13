// SPDX-License-Identifier: GPL-2.0-or-later
// The inspector, the link inspector, the project sheet and the show-source sheet (phase-2.md 9.1,
// 9.3, 11.1; T17) in the built app: desktop Chrome (a side panel) and Pixel 7 (a bottom sheet).
// Each edit is made through the real fields and checked three ways: the toast, the text patch (the
// workspace text through the `?hooks=edits` hook, hand-written expected text) and the engine's
// reschedule (the toast settles on a result that includes it). Undo is Mod-Z. With SCREENSHOTS=1 it
// writes docs/phases/screenshots/phase-2/inspector-*, project-sheet-* and source-sheet-*.png.
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

interface Hooks {
	action(a: unknown): Promise<{ status: string }>;
	text(path?: string): string | null;
	revision(): number | null;
}
type W = { __mainspringEdits: Hooks };
const text = (page: Page) => page.evaluate(() => (window as unknown as W).__mainspringEdits.text());
const revision = (page: Page) =>
	page.evaluate(() => (window as unknown as W).__mainspringEdits.revision());
const action = (page: Page, a: unknown) =>
	page.evaluate((x) => (window as unknown as W).__mainspringEdits.action(x), a);

const phone = (info: { project: { name: string } }) => info.project.name !== 'desktop';

async function open(page: Page, mode = 'visual'): Promise<void> {
	await page.goto(`/app?sample=gantt-manipulation&mode=${mode}&hooks=edits`);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.locator('[role="row"][data-key]').first()).toBeVisible();
	await expect.poll(() => revision(page)).not.toBeNull();
	// The dev tools of the Gantt settle (first paint, fonts).
	await page.waitForTimeout(500);
}

/** Where the details are: the side panel on a desktop, the bottom sheet elsewhere. */
const details = (page: Page, info: { project: { name: string } }): Locator =>
	phone(info)
		? page.getByRole('dialog', { name: /Task details|Link details/ })
		: page.getByRole('complementary', { name: 'Details' });

const row = (page: Page, name: string) =>
	page.locator('[role="treegrid"] [role="row"][data-key]').filter({ hasText: name }).first();

/** Selects a task row, as a click or a tap does, and waits for its details. */
async function select(page: Page, info: { project: { name: string } }, name: string) {
	await row(page, name).click();
	const panel = details(page, info);
	await expect(panel.getByLabel('Name', { exact: true })).toHaveValue(name);
	return panel;
}

/** Undo in the newest toast: what Mod-Z does, and it works from a text field too. */
const undoToast = (page: Page) =>
	page.getByTestId('toast').last().getByRole('button', { name: 'Undo' }).click();

/** After an edit: the newest toast settles on a schedule that includes it. */
async function settled(page: Page): Promise<void> {
	await expect(page.getByTestId('toast').last()).toHaveAttribute('data-status', 'scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
}

test.describe('the inspector', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T17)');
	});
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('opens from a row; the stepper, a rename and a gap edit the text, and undo restores it', async ({
		page,
	}, info) => {
		await open(page);
		const original = (await text(page)) ?? '';
		expect(original).toContain('effort 3d');

		// A row opens the details: a side panel on a desktop, a half-height sheet on a phone.
		const panel = await select(page, info, 'Research');
		if (phone(info)) {
			await expect(panel).toBeInViewport({ ratio: 1 });
			const box = await panel.boundingBox();
			const view = page.viewportSize();
			const bar = await page.locator('.tabbar').boundingBox();
			expect(box && view && bar).toBeTruthy();
			if (box && view && bar) {
				// Pinned just above the tab bar, about half the room above it, and the row is above
				// it (WCAG 2.4.11).
				expect(Math.abs(box.y + box.height - bar.y)).toBeLessThan(2 + 12);
				expect(box.height).toBeGreaterThan(view.height * 0.35);
				expect(box.height).toBeLessThan(view.height * 0.55);
				const r = await row(page, 'Research').boundingBox();
				expect(r && r.y + r.height).toBeLessThanOrEqual(box.y + 1);
			}
		}

		// The size: one burst of presses is one edit and one undo step.
		const effort = panel.getByRole('group', { name: 'Effort' });
		await expect(effort.getByRole('textbox')).toHaveValue('3d');
		const more = effort.getByRole('button', { name: 'Increase Effort' });
		await more.click();
		await more.click();
		await more.click();
		await expect(effort.getByRole('textbox')).toHaveValue('6d');
		const rev0 = await revision(page);
		await expect.poll(() => text(page)).toBe(original.replace('effort 3d', 'effort 6d'));
		await expect(page.getByTestId('toast')).toHaveCount(1);
		await expect(page.getByTestId('toast').first()).toContainText('Effort of Research: 3d to 6d');
		await settled(page);
		expect(await revision(page)).toBeGreaterThan(rev0 ?? 0);
		await expect(effort.getByRole('textbox')).toHaveValue('6d');
		// One Mod-Z undoes the whole burst.
		await page.keyboard.press('Control+z');
		await expect.poll(() => text(page)).toBe(original);
		await expect(effort.getByRole('textbox')).toHaveValue('3d');
		await page.keyboard.press('Control+y');
		await expect.poll(() => text(page)).toBe(original.replace('effort 3d', 'effort 6d'));
		await page.keyboard.press('Control+z');
		await expect.poll(() => text(page)).toBe(original);

		// A typed size, with a unit.
		await effort.getByRole('textbox').fill('4d');
		await effort.getByRole('textbox').press('Enter');
		await expect.poll(() => text(page)).toBe(original.replace('effort 3d', 'effort 4d'));
		await settled(page);
		await undoToast(page);
		await expect.poll(() => text(page)).toBe(original);

		// A rename: the name is the string, nothing else moves.
		const name = panel.getByLabel('Name', { exact: true });
		await name.fill('Study');
		await name.press('Enter');
		await expect
			.poll(() => text(page))
			.toBe(original.replace('task research "Research"', 'task research "Study"'));
		await expect(page.getByTestId('toast').last()).toContainText('Renamed Research to Study');
		await settled(page);
		const renamed = (await text(page)) ?? '';

		// A gap on a link, in the task's own list: Sketch waits for the renamed task.
		const sketch = await select(page, info, 'Sketch');
		const gap = sketch.getByLabel('Gap after Study');
		await expect(gap).toHaveValue('2d');
		await gap.fill('3d');
		await gap.press('Enter');
		await expect
			.poll(() => text(page))
			.toBe(
				renamed.replace('depends !research { gaplength 2d }', 'depends !research { gaplength 3d }'),
			);
		await settled(page);

		// The link's own details: the same link, another way in.
		await sketch
			.getByRole('button', { name: /^Details\s*:\s*Open the link/ })
			.first()
			.click();
		const link = details(page, info);
		await expect(link.getByText('Sketch waits for Study')).toBeVisible();
		await expect(link.getByText('Finish to start')).toBeVisible();
		const linkGap = link.getByLabel('Gap', { exact: true });
		await expect(linkGap).toHaveValue('3d');
		await linkGap.fill('1d');
		await linkGap.press('Enter');
		await expect
			.poll(() => text(page))
			.toBe(
				renamed.replace('depends !research { gaplength 2d }', 'depends !research { gaplength 1d }'),
			);
		await settled(page);
		// Remove takes the link out of the text and back to the task.
		await link.getByRole('button', { name: 'Remove', exact: true }).click();
		await expect.poll(() => text(page)).not.toContain('depends !research');
		await settled(page);
	});

	test('the project sheet edits the header and keeps the move preference', async ({
		page,
	}, info) => {
		await open(page);
		const original = (await text(page)) ?? '';
		await page.locator('header').getByRole('button', { name: 'Project settings' }).click();
		const sheet = page.getByRole('dialog', { name: 'Project' });
		await expect(sheet).toBeVisible();
		await expect(sheet).toBeInViewport({ ratio: 1 });

		// The name and the status date are written into the header.
		await sheet.getByLabel('Name', { exact: true }).fill('Renamed plan');
		await sheet.getByLabel('Name', { exact: true }).press('Enter');
		await expect
			.poll(() => text(page))
			.toBe(original.replace('"Gantt manipulation"', '"Renamed plan"'));
		await settled(page);
		const status = sheet.getByLabel('Status date');
		await expect(status).toHaveValue('2026-03-09-09:00');
		await status.fill('2026-03-10-09:00');
		await status.press('Enter');
		await expect
			.poll(() => text(page))
			.toBe(
				original
					.replace('"Gantt manipulation"', '"Renamed plan"')
					.replace('now 2026-03-09-09:00', 'now 2026-03-10-09:00'),
			);
		await settled(page);

		// The move preference: once per browser. Nothing stored asks; the choice is remembered, and
		// clearing it makes the next move ask again.
		const stored = () => page.evaluate(() => localStorage.getItem('mainspring.gantt.move'));
		expect(await stored()).toBeNull();
		const ask = sheet.getByRole('radio', { name: 'Ask me next time' });
		const startChoice = sheet.getByRole('radio', { name: 'Give the task a fixed start date' });
		await expect(ask).toBeChecked();
		await startChoice.check();
		expect(await stored()).toBe('start');
		// Closed and opened again, the sheet shows the stored answer.
		await sheet.getByRole('button', { name: 'Close' }).click();
		await page.locator('header').getByRole('button', { name: 'Project settings' }).click();
		await expect(startChoice).toBeChecked();
		// A move now writes the gap with no question...
		const moved = await action(page, { type: 'move', task: 'design.sketch', days: 1 });
		expect(moved.status).toBe('applied');
		expect((await text(page)) ?? '').toMatch(/task sketch "Sketch" \{\n\s+start \d{4}-\d\d-\d\d\n/);
		await sheet.getByRole('button', { name: 'Close' }).click();
		await undoToast(page);
		await expect
			.poll(() => text(page))
			.toBe(
				original
					.replace('"Gantt manipulation"', '"Renamed plan"')
					.replace('now 2026-03-09-09:00', 'now 2026-03-10-09:00'),
			);
		await page.locator('header').getByRole('button', { name: 'Project settings' }).click();
		await ask.check();
		expect(await stored()).toBe('');
		await sheet.getByRole('button', { name: 'Close' }).click();
		// ...and after clearing it asks again.
		const again = await action(page, { type: 'move', task: 'design.sketch', days: 1 });
		expect(again.status).toBe('ask-move-preference');
		void info;
	});

	test('asks before a milestone becomes an open-ended task, and "Set effort" focuses the size', async ({
		page,
	}, info) => {
		await open(page);
		const original = (await text(page)) ?? '';
		// Spike has a start and a person and no size: it runs to the project end (11.1).
		const panel = await select(page, info, 'Spike');
		await expect(
			panel.getByText(/books Dev 3 until the project end|until the project end/),
		).toBeVisible();
		// Make it a milestone, then turn that off: the question comes first.
		await panel.getByRole('checkbox', { name: 'Milestone' }).check();
		await expect.poll(() => text(page)).toContain('milestone');
		await settled(page);
		// The box stays checked while the question is open: nothing is changed yet.
		await panel.getByRole('checkbox', { name: 'Milestone' }).click();
		await expect(panel.getByRole('checkbox', { name: 'Milestone' })).toBeChecked();
		const ask = panel.getByRole('group', { name: 'Task without a size' });
		await expect(ask).toContainText('Add an effort?');
		await expect(ask.getByRole('button', { name: 'Set effort' })).toBeFocused();
		// Nothing changed yet.
		expect((await text(page)) ?? '').toContain('milestone');
		// Escape drops the question and returns to the box it came from (L4).
		await page.keyboard.press('Escape');
		await expect(ask).toBeHidden();
		await expect(panel.getByRole('checkbox', { name: 'Milestone' })).toBeFocused();
		await expect(panel.getByRole('checkbox', { name: 'Milestone' })).toBeChecked();
		await panel.getByRole('checkbox', { name: 'Milestone' }).click();
		await expect(ask.getByRole('button', { name: 'Set effort' })).toBeFocused();
		// "Set effort" clears the milestone and puts the focus on the size field.
		await ask.getByRole('button', { name: 'Set effort' }).click();
		await expect.poll(() => text(page)).toBe(original);
		const size = panel.getByRole('textbox', { name: 'Effort' });
		await expect(size).toBeFocused();
		await size.fill('2d');
		await size.press('Enter');
		await expect.poll(() => text(page)).toContain('effort 2d');
		await settled(page);
	});

	test('shows the source of a task, highlighted, and opens it in the text', async ({
		page,
	}, info) => {
		await open(page);
		const panel = await select(page, info, 'Research');
		await panel.getByRole('button', { name: 'Show source' }).click();
		const sheet = page.getByRole('dialog', { name: 'Source of Research' });
		await expect(sheet).toBeVisible();
		await expect(sheet).toBeInViewport({ ratio: 1 });
		const code = sheet.getByRole('region', { name: 'Plan text' });
		await expect(code).toContainText('task research "Research"');
		await expect(code).toContainText('effort 3d');
		// Highlighted without an editor: the keyword is a classed span.
		await expect(code.locator('.tok-keyword', { hasText: 'effort' })).toBeVisible();
		await sheet.getByRole('button', { name: 'Open in text' }).click();
		await expect(page.locator('.cm-content')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(page.locator('.cm-activeLine, .cm-selectionBackground').first()).toBeVisible();
	});
});

test.describe('the details on a phone and in a narrow Split', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T17)');
	});
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('a press after a pause is not ignored: one press, a pause, one press is +2 (M1)', async ({
		page,
	}, info) => {
		await open(page);
		const original = (await text(page)) ?? '';
		const panel = await select(page, info, 'Research');
		const effort = panel.getByRole('group', { name: 'Effort' });
		const more = effort.getByRole('button', { name: 'Increase Effort' });
		await more.click();
		// The burst ends by its pause (1.2 s) and its edit is in the text.
		await expect.poll(() => text(page)).toBe(original.replace('effort 3d', 'effort 4d'));
		await page.waitForTimeout(1700);
		await more.click();
		await expect(effort.getByRole('textbox')).toHaveValue('5d');
		await expect.poll(() => text(page)).toBe(original.replace('effort 3d', 'effort 5d'));
		await settled(page);
		await expect(effort.getByRole('textbox')).toHaveValue('5d');
	});

	test('on a phone the sheet ends above the tab bar, at both heights, with a status chip (M3, M4)', async ({
		page,
	}, info) => {
		test.skip(!phone(info), 'the phone sheet');
		await open(page);
		const panel = await select(page, info, 'Research');
		const tabbar = page.locator('.tabbar');
		await expect(tabbar).toBeVisible();
		const gap = async (): Promise<number> => {
			const a = await panel.boundingBox();
			const t = await tabbar.boundingBox();
			return a && t ? t.y - (a.y + a.height) : Number.NaN;
		};
		// The sheet ends at or above the tab bar (a gap of 0 or more), at either height.
		const above = () => expect.poll(gap).toBeGreaterThanOrEqual(-1);
		await above();
		const grab = panel.getByRole('button', { name: /Details height/ });
		await grab.click();
		await expect(grab).toHaveAttribute('aria-expanded', 'true');
		await above();
		await expect.poll(async () => (await panel.boundingBox())?.y ?? 999).toBeLessThan(40);
		await grab.click();
		await page.waitForTimeout(300);
		await above();
		// The sheet covers the status strip, so it carries the state itself.
		await expect(panel.getByText('Scheduled', { exact: true })).toBeVisible();
	});

	test('on a phone the toasts stay on screen with Undo reachable, also at full height (M2)', async ({
		page,
	}, info) => {
		test.skip(!phone(info), 'the phone sheet');
		await open(page);
		const original = (await text(page)) ?? '';
		const panel = await select(page, info, 'Research');
		await panel.getByRole('button', { name: /Details height/ }).click();
		await expect(panel.getByRole('button', { name: /Details height/ })).toHaveAttribute(
			'aria-expanded',
			'true',
		);
		await page.waitForTimeout(300);
		const effort = panel.getByRole('group', { name: 'Effort' });
		await effort.getByRole('textbox').fill('5d');
		await effort.getByRole('textbox').press('Enter');
		const toast = page.getByTestId('toast').last();
		await expect(toast).toContainText('Effort of Research: 3d to 5d');
		await expect(toast).toBeInViewport({ ratio: 1 });
		const undo = toast.getByRole('button', { name: 'Undo' });
		await expect(undo).toBeInViewport({ ratio: 1 });
		await undo.click();
		await expect.poll(() => text(page)).toBe(original);
		// Half height: the toast is above the sheet, and also on screen.
		await panel.getByRole('button', { name: /Details height/ }).click();
		await page.waitForTimeout(300);
		await effort.getByRole('textbox').fill('4d');
		await effort.getByRole('textbox').press('Enter');
		const t2 = page.getByTestId('toast').last();
		await expect(t2).toContainText('Effort of Research: 3d to 4d');
		await expect(t2).toBeInViewport({ ratio: 1 });
		const sheet = await panel.boundingBox();
		const tb = await t2.boundingBox();
		expect(sheet && tb && tb.y + tb.height <= sheet.y + 1).toBe(true);
	});

	test('a narrow Split has a rail, and a click opens a drawer over the chart (M5)', async ({
		page,
	}, info) => {
		test.skip(phone(info), 'a desktop');
		await page.setViewportSize({ width: 1280, height: 800 });
		await open(page, 'split');
		const editor = page.locator('#panel-text');
		const gantt = page.locator('#panel-gantt');
		const rail = page.getByRole('button', { name: 'Show details' });
		await expect(rail).toBeVisible();
		await expect(page.getByRole('complementary', { name: 'Details' })).toHaveCount(0);
		const editorBefore = await editor.boundingBox();
		const ganttBefore = await gantt.boundingBox();
		// A click selects and opens the drawer: over the chart's right edge, no width taken.
		await row(page, 'Research').click();
		const drawer = page.getByRole('complementary', { name: 'Details' });
		await expect(drawer).toBeVisible();
		await expect(drawer.getByLabel('Name', { exact: true })).toHaveValue('Research');
		const d = await drawer.boundingBox();
		const g = await gantt.boundingBox();
		expect(d && g).toBeTruthy();
		if (d && g) {
			expect(d.x).toBeGreaterThan(g.x);
			expect(d.x + d.width).toBeLessThanOrEqual(g.x + g.width + 1);
			expect(d.width).toBeGreaterThan(300);
		}
		const editorAfter = await editor.boundingBox();
		const ganttAfter = await gantt.boundingBox();
		expect(editorAfter?.width).toBe(editorBefore?.width);
		expect(ganttAfter?.width).toBe(ganttBefore?.width);
		// The drawer edits like the panel does.
		const effort = drawer.getByRole('group', { name: 'Effort' });
		await effort.getByRole('textbox').fill('4d');
		await effort.getByRole('textbox').press('Enter');
		await expect.poll(() => text(page)).toContain('effort 4d');
		await settled(page);
		await undoToast(page);
		// Escape closes it and returns to the row; the rail's toggle opens and closes it too.
		await drawer.getByLabel('Name', { exact: true }).focus();
		await page.keyboard.press('Escape');
		await expect(drawer).toBeHidden();
		await expect(row(page, 'Research')).toBeFocused();
		await page.getByRole('button', { name: 'Show details' }).click();
		await expect(drawer).toBeVisible();
		await page.getByRole('button', { name: 'Hide details' }).last().click();
		await expect(drawer).toBeHidden();
		if (process.env['SCREENSHOTS']) {
			await row(page, 'Research').click();
			await expect(drawer).toBeVisible();
			await page.waitForTimeout(400);
			await page.screenshot({
				path: path.join(DIR, `inspector-split-1280-${info.project.name}-light.png`),
			});
		}
	});
});

test.describe('the inspector is accessible', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T17)');
	});
	test.setTimeout(READY_TIMEOUT_MS * 2);

	for (const scheme of ['light', 'dark'] as const) {
		test(`axe passes with the details, the project sheet and the source open, ${scheme}`, async ({
			page,
		}, info) => {
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			const panel = await select(page, info, 'Research');
			const scan = async (label: string) => {
				const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
				expect(
					r.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target).join(' ')}`),
				).toEqual([]);
			};
			await scan('details');
			await panel.getByRole('button', { name: 'Show source' }).click();
			await expect(page.getByRole('dialog', { name: 'Source of Research' })).toBeVisible();
			await scan('source');
			await page
				.getByRole('dialog', { name: 'Source of Research' })
				.getByRole('button', { name: 'Close' })
				.click();
			await page.locator('header').getByRole('button', { name: 'Project settings' }).click();
			await expect(page.getByRole('dialog', { name: 'Project' })).toBeVisible();
			await scan('project');
		});
	}
});

// Screenshots, desktop and Pixel 7, light and dark (CLAUDE.md "Mobile counts").
test.describe('inspector screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to refresh docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS * 2);

	for (const scheme of ['light', 'dark'] as const) {
		test(`inspector, project sheet and source sheet, ${scheme}`, async ({ page }, info) => {
			test.skip(info.project.name === 'iphone-14');
			if (!phone(info)) await page.setViewportSize({ width: 1440, height: 860 });
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			const shot = (name: string) =>
				page.screenshot({ path: path.join(DIR, `${name}-${info.project.name}-${scheme}.png`) });
			const panel = await select(page, info, 'Research');
			await page.waitForTimeout(400);
			await shot('inspector');
			if (phone(info)) {
				// Dragged to full height with the grabber.
				await panel.getByRole('button', { name: /Details height/ }).click();
				await page.waitForTimeout(400);
				await shot('inspector-full');
				await panel.getByRole('button', { name: /Details height/ }).click();
			}
			await panel.getByRole('button', { name: 'Show source' }).click();
			await page.waitForTimeout(400);
			await shot('source-sheet');
			await page
				.getByRole('dialog', { name: 'Source of Research' })
				.getByRole('button', { name: 'Close' })
				.click();
			await page.locator('header').getByRole('button', { name: 'Project settings' }).click();
			await page.waitForTimeout(400);
			await shot('project-sheet');
		});
	}
});

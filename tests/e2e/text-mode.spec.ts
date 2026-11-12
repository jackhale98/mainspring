// SPDX-License-Identifier: GPL-2.0-or-later
// Text mode end-to-end suite (phase-1.md 9.4, T20), on desktop Chrome, Pixel 7 and iPhone 14.
// Covers what the smoke spec (text-mode-smoke.spec.ts) does not: diagnostics from an engine run,
// a changed effort, completion and hover text equal to TaskJuggler's own syntax() output, the
// phone docs sheet, Format, outline clicks across files and axe with the editor's popups open.
// Edits are small inserts (CDP insertText is slow for big ones on phones).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
	READY_TIMEOUT_MS,
	cursorAtEndOf,
	editor,
	engineKeyword,
	finish,
	generatedKeyword,
	openApp,
	settled,
	showOutline,
	strip,
	wordBox,
} from './lib/text-mode';

test.describe('text mode', () => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	test('an unknown task in depends is marked on its own line after the run', async ({ page }) => {
		await openApp(page);
		await cursorAtEndOf(page, page.locator('.cm-line', { hasText: 'depends !ready' }));
		await page.keyboard.press('Enter');
		// Under EditContext (Pixel 7) CodeMirror holds Enter until the next animation frame
		// (delayAndroidKey in @codemirror/view); a transaction dispatched before then drops it
		// silently. Wait for the new, new line before typing; do not remove this.
		await expect(page.locator('.cm-activeLine')).not.toContainText('depends');
		await page.keyboard.insertText('depends nosuchtask');
		// The 300 ms pause, then the run, then the engine's message lands on the line.
		await settled(page);
		const marked = page.locator('.cm-line', { has: page.locator('.cm-lintRange-error') });
		await expect(marked).toHaveCount(1);
		await expect(marked).toContainText('depends nosuchtask');
		await expect(strip(page).getByRole('button', { name: /error/ })).toBeVisible();
		await expect(strip(page)).toContainText('last good');
		await page.keyboard.press('ControlOrMeta+z');
		await settled(page);
		await expect(page.locator('.cm-lintRange-error')).toHaveCount(0);
		await expect(strip(page)).toContainText('No problems');
	});

	test('changing an effort updates the finish date', async ({ page }) => {
		await openApp(page);
		const before = await finish(page).getAttribute('datetime');
		const line = page.locator('.cm-line', { hasText: /^\s*effort 2d$/ }).first();
		await cursorAtEndOf(page, line);
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Backspace');
		await page.keyboard.insertText('40d');
		await expect(page.locator('.cm-activeLine')).toHaveText('    effort 40d');
		await settled(page);
		await expect(strip(page)).toContainText('No problems');
		await expect
			.poll(async () => new Date((await finish(page).getAttribute('datetime')) ?? '').getTime())
			.toBeGreaterThan(new Date(before ?? '').getTime());
		await page.keyboard.press('ControlOrMeta+z');
		await settled(page);
		await expect(finish(page)).toHaveAttribute('datetime', before ?? '');
	});

	test('completion in a task body offers effort with the engine syntax line', async ({ page }) => {
		const table = generatedKeyword('effort');
		const engine = await engineKeyword('effort');
		// The committed table (gen:keywords) and the engine agree on the syntax line.
		expect(table.syntax).toBe(engine.syntax);
		await openApp(page);
		await cursorAtEndOf(page, page.locator('.cm-line', { hasText: 'allocate mira' }));
		await page.keyboard.press('Enter');
		// Under EditContext (Pixel 7) CodeMirror holds Enter until the next animation frame
		// (delayAndroidKey in @codemirror/view); a transaction dispatched before then drops it
		// silently. Wait for the new, empty line before typing; do not remove this.
		await expect(page.locator('.cm-activeLine')).toHaveText(/^\s*$/);
		await page.keyboard.type('effort');
		const list = page.locator('.cm-tooltip-autocomplete');
		await expect(list).toBeVisible();
		const option = list
			.getByRole('option')
			.filter({ has: page.locator('.cm-completionLabel', { hasText: /^effort$/ }) });
		await expect(option).toHaveCount(1);
		await expect(option.locator('.cm-completionDetail')).toHaveText(engine.syntax);
		// Beside the list, the engine's full documentation (the summary until it has loaded).
		await expect(page.locator('.cm-completionInfo')).toHaveText(engine.doc, { timeout: 10_000 });
		await page.keyboard.press('Escape');
		await expect(list).toBeHidden();
	});

	test('hover shows the engine documentation for a keyword', async ({ page, hasTouch }) => {
		test.skip(hasTouch, 'hover does not exist on touch; the Docs sheet test covers phones');
		const table = generatedKeyword('effort');
		const engine = await engineKeyword('effort');
		await openApp(page);
		const line = page.locator('.cm-line', { hasText: /^\s*effort 2d$/ }).first();
		// Under the status strip otherwise: the mouse would hit the strip, not the editor.
		await line.scrollIntoViewIfNeeded();
		const box = await wordBox(line, 'effort');
		const tip = page.locator('.cm-tjp-hover');
		// The docs may arrive just after the first tip; move away and back until the full text shows.
		await expect(async () => {
			await page.mouse.move(0, 0);
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await expect(tip).toBeVisible({ timeout: 3_000 });
			await expect(tip.locator('.cm-tjp-hover-body')).toHaveText(engine.doc, { timeout: 1_000 });
		}).toPass({ timeout: 30_000 });
		await expect(tip.locator('.cm-tjp-hover-title')).toHaveText(table.name);
		await expect(tip.locator('.cm-tjp-hover-code')).toHaveText(engine.syntax);
	});

	test('the Docs sheet shows the engine documentation for the keyword at the cursor', async ({
		page,
	}) => {
		const table = generatedKeyword('effort');
		const engine = await engineKeyword('effort');
		await openApp(page);
		await cursorAtEndOf(page, page.locator('.cm-line', { hasText: /^\s*effort 2d$/ }).first());
		const sheet = page.getByRole('dialog', { name: 'Documentation' });
		await expect(async () => {
			if (!(await sheet.isVisible())) await page.getByRole('button', { name: 'Docs' }).click();
			await expect(sheet.locator('.body')).toHaveText(engine.doc, { timeout: 1_000 });
		}).toPass({ timeout: 30_000 });
		await expect(sheet.getByRole('heading', { level: 3 })).toHaveText(table.name);
		await expect(sheet.locator('.code')).toHaveText(engine.syntax);
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
	});

	test('Format re-indents a badly indented block and leaves the plan scheduled', async ({
		page,
	}) => {
		await openApp(page);
		await editor(page).click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.insertText('task messy "Messy" {\nduration 3d\n        priority 501\n}\n');
		await settled(page);
		await expect(strip(page)).toContainText('No problems');
		const lineText = (text: string) =>
			page
				.locator('.cm-line', { hasText: text })
				.first()
				.evaluate((el) => el.textContent);
		expect(await lineText('duration 3d')).not.toBe('  duration 3d');
		await page.getByRole('button', { name: 'Format', exact: true }).click();
		await expect.poll(() => lineText('duration 3d')).toBe('  duration 3d');
		expect(await lineText('priority 501')).toBe('  priority 501');
		expect(await lineText('task messy')).toBe('task messy "Messy" {');
		// Format runs the scheduler at once; the plan is the same and still has no problems.
		await expect(strip(page).locator('.state')).not.toHaveAttribute('data-kind', 'scheduling', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(strip(page)).toContainText('No problems');
	});

	test('outline clicks move the cursor to the declaration in another file', async ({
		page,
		viewport,
	}) => {
		await openApp(page);
		const phone = (viewport?.width ?? 0) < 600;
		const openFile = async (path: string) => {
			if (phone) await expect(page.getByRole('combobox', { name: 'File' })).toHaveValue(path);
			else
				await expect(page.getByRole('tab', { name: path })).toHaveAttribute(
					'aria-selected',
					'true',
				);
		};
		// plan.tjp -> lib/resources.tji -> lib/tasks.tji -> plan.tjp
		await showOutline(page);
		await page
			.getByRole('tree', { name: 'Resources' })
			.getByRole('treeitem', { name: /Mira/ })
			.click();
		await openFile('lib/resources.tji');
		await expect(page.locator('.cm-activeLine')).toContainText('resource mira');
		await showOutline(page);
		await page
			.getByRole('tree', { name: 'Tasks' })
			.getByRole('treeitem', { name: /Vorbereitung/ })
			.click();
		await openFile('lib/tasks.tji');
		await expect(page.locator('.cm-activeLine')).toContainText('task prep');
		await showOutline(page);
		await page
			.getByRole('tree', { name: 'Tasks' })
			.getByRole('treeitem', { name: /Rollout/ })
			.click();
		await openFile('plan.tjp');
		await expect(page.locator('.cm-activeLine')).toContainText('task rollout');
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`has no axe violations with a completion list and the Docs sheet open (${scheme})`, async ({
			page,
		}) => {
			await page.emulateMedia({ colorScheme: scheme });
			await openApp(page);
			const axe = () =>
				new AxeBuilder({ page })
					.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
					.analyze();
			await cursorAtEndOf(page, page.locator('.cm-line', { hasText: 'allocate mira' }));
			await page.keyboard.press('Enter');
			// Under EditContext (Pixel 7) CodeMirror holds Enter until the next animation frame
			// (delayAndroidKey in @codemirror/view); a transaction dispatched before then drops it
			// silently. Wait for the new, empty line before typing; do not remove this.
			await expect(page.locator('.cm-activeLine')).toHaveText(/^\s*$/);
			await page.keyboard.type('eff');
			await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
			expect((await axe()).violations, 'completion list').toEqual([]);
			await page.keyboard.press('Escape');
			await page.keyboard.press('ControlOrMeta+z');
			await page.getByRole('button', { name: 'Docs' }).click();
			await expect(page.getByRole('dialog', { name: 'Documentation' })).toBeVisible();
			expect((await axe()).violations, 'docs sheet').toEqual([]);
		});
	}
});

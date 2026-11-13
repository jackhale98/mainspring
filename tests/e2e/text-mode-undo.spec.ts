// SPDX-License-Identifier: GPL-2.0-or-later
// Unified undo in Text mode (phase-2.md 6.7, ADR-0008), on desktop Chrome, Pixel 7 and iPhone 14:
// a typo fixed at once leaves the step before it undoable; Mod-Z after switching files undoes
// the change in the other file, opens it and says so; a change that bypassed the history clears
// it with a note. With SCREENSHOTS=1 the notes are saved to docs/phases/screenshots/phase-2/
// (CLAUDE.md "Mobile counts").
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, cursorAtEndOf, openApp, showOutline } from './lib/text-mode';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');
const note = (page: Page) => page.locator('.editor p.note');
const doc = (page: Page) => page.locator('.cm-content').innerText();

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
	if (!process.env['SCREENSHOTS']) return;
	const device = info.project.name === 'pixel-7' ? 'pixel7' : info.project.name;
	await page.screenshot({ path: path.join(DIR, `text-undo-${name}-${device}.png`) });
}

async function activeFile(page: Page, file: string, phone: boolean): Promise<void> {
	if (phone) await expect(page.getByRole('combobox', { name: 'File' })).toHaveValue(file);
	else await expect(page.getByRole('tab', { name: file })).toHaveAttribute('aria-selected', 'true');
}

/**
 * A change that bypasses the history, as a collaborator's would: a transaction marked
 * `addToHistory: false`, dispatched to the editor view (found through CodeMirror's DOM link,
 * test-only).
 */
async function bypass(page: Page): Promise<void> {
	await page.evaluate(() => {
		type View = {
			state: { update(spec: object): { constructor: unknown }; doc: { length: number } };
			dispatch(spec: object): void;
		};
		const content = document.querySelector('.cm-content') as
			(Element & { cmTile?: { root?: { view?: View } } }) | null;
		const view = content?.cmTile?.root?.view;
		if (!view) throw new Error('no editor view');
		const Tr = view.state.update({}).constructor as {
			addToHistory: { of(v: boolean): unknown };
		};
		view.dispatch({ changes: { from: 0, insert: '#' }, annotations: Tr.addToHistory.of(false) });
	});
}

test.describe('unified undo', () => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	test('a typo fixed at once keeps the edit before it undoable and redoable', async ({ page }) => {
		await openApp(page);
		const t0 = await doc(page);
		await cursorAtEndOf(page, page.locator('.cm-line', { hasText: /^\s*effort 2d$/ }).first());
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Backspace');
		await page.keyboard.insertText('5d');
		await expect(page.locator('.cm-activeLine')).toHaveText(/effort 5d$/);
		// A pause, so the typo is a group of its own: "x", then Backspace.
		await page.waitForTimeout(800);
		const t1 = await doc(page);
		await page.keyboard.insertText('x');
		await page.keyboard.press('Backspace');
		await expect.poll(() => doc(page)).toBe(t1);
		for (let i = 0; i < 2; i++) {
			await page.keyboard.press('ControlOrMeta+z');
			await expect.poll(() => doc(page)).toBe(t0);
			await page.keyboard.press('ControlOrMeta+Shift+KeyZ');
			await expect.poll(() => doc(page)).toBe(t1);
		}
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => doc(page)).toBe(t0);
		await expect(note(page)).not.toContainText('cleared');
	});

	test('Mod-Z after switching files undoes the other file, opens it and says so', async ({
		page,
		viewport,
	}, info) => {
		const phone = (viewport?.width ?? 0) < 600;
		await openApp(page);
		await cursorAtEndOf(page, page.locator('.cm-line', { hasText: 'task rollout' }));
		const t0 = await doc(page);
		await page.keyboard.press('End');
		await page.keyboard.insertText(' # later');
		await expect(page.locator('.cm-activeLine')).toContainText('# later');
		// Another file: the outline puts the cursor on a task in lib/tasks.tji.
		await showOutline(page);
		await page
			.getByRole('tree', { name: 'Tasks' })
			.getByRole('treeitem', { name: /Vorbereitung/ })
			.click();
		await activeFile(page, 'lib/tasks.tji', phone);
		// On touch the editor does not take the focus: the window's binding handles the key.
		await page.keyboard.press('ControlOrMeta+z');
		await activeFile(page, 'plan.tjp', phone);
		await expect.poll(() => doc(page)).toBe(t0);
		await expect(note(page)).toHaveText('Undone: typing (plan.tjp)');
		await shot(page, info, 'note');
		await page.keyboard.press('ControlOrMeta+y');
		await expect(page.locator('.cm-line', { hasText: '# later' })).toHaveCount(1);
	});

	test('a change outside the history clears it, with a note', async ({ page }, info) => {
		await openApp(page);
		await cursorAtEndOf(page, page.locator('.cm-line', { hasText: 'task rollout' }));
		await page.keyboard.insertText(' # later');
		await bypass(page);
		const before = await doc(page);
		await page.keyboard.press('ControlOrMeta+z');
		await expect(note(page)).toHaveText(
			'A file changed outside the undo history, so undo and redo were cleared.',
		);
		expect(await doc(page)).toBe(before);
		await shot(page, info, 'diverged');
	});
});

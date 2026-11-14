// SPDX-License-Identifier: GPL-2.0-or-later
// Undo on a phone: no toast after an edit, Undo and Redo in the top bar, a compact message for what
// needs reading, the History sheet (press and hold Undo) that rewinds several steps after a
// confirmation, and the theme choice in the status card (the top bar has no room for its toggle).
// Pixel 7; desktop keeps its toasts and its toggle. Screenshots (SCREENSHOTS=1) go to
// docs/phases/screenshots/phase-2/phone-undo-*.png.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join('docs', 'phases', 'screenshots', 'phase-2');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

interface Hooks {
	action(a: unknown): Promise<{ status: string }>;
	text(path?: string): string | null;
}
const act = (page: Page, a: unknown) =>
	page.evaluate(
		(x) => (window as unknown as { __mainspringEdits: Hooks }).__mainspringEdits.action(x),
		a,
	);
const text = (page: Page) =>
	page.evaluate(() => (window as unknown as { __mainspringEdits: Hooks }).__mainspringEdits.text());

async function open(page: Page): Promise<void> {
	await page.goto('/app?sample=gantt-manipulation&mode=visual&hooks=edits');
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByTestId('gantt-overlay')).toBeVisible();
}

/** Three edits, each its own undo step: the sizes of three tasks (their text and labels differ). */
const EDITS = [
	{ type: 'size-step', task: 'design.research', steps: 1 },
	{ type: 'progress', task: 'design.research', percent: 75 },
	{ type: 'size-step', task: 'design.docs', steps: 1 },
] as const;

async function edit3(page: Page): Promise<string[]> {
	const texts = [(await text(page)) ?? ''];
	for (const a of EDITS) {
		expect((await act(page, a)).status).toBe('applied');
		texts.push((await text(page)) ?? '');
	}
	return texts;
}

/** A finger held on an element for `ms` (CDP touch events: Playwright's `tap` cannot hold). */
async function hold(page: Page, testid: string, ms: number): Promise<void> {
	const box = await page.getByTestId(testid).boundingBox();
	if (!box) throw new Error(`no ${testid}`);
	const p = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
	await page.waitForTimeout(ms);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
}

async function shot(page: Page, name: string): Promise<void> {
	if (process.env['SCREENSHOTS'] !== '1') return;
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		await page.waitForTimeout(300);
		await page.screenshot({ path: path.join(DIR, `phone-undo-${name}-${scheme}.png`) });
	}
	await page.emulateMedia({ colorScheme: 'light' });
}

async function axe(page: Page, state: string): Promise<void> {
	const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const detail = r.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
	);
	expect(detail, state).toEqual([]);
}

test.describe('undo on a phone', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name !== 'pixel-7', 'the phone layout');
	});
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('an edit shows no toast; Undo and Redo are in the top bar and name the edit', async ({
		page,
	}) => {
		await open(page);
		const undo = page.getByTestId('undo');
		const redo = page.getByTestId('redo');
		await expect(undo).toBeDisabled();
		await expect(undo).toHaveAccessibleName('Undo, nothing to undo');
		const original = (await text(page)) ?? '';

		expect((await act(page, EDITS[0])).status).toBe('applied');
		const edited = (await text(page)) ?? '';
		expect(edited).not.toBe(original);
		// No toast on the screen; the live region still holds what happened.
		await expect(page.getByTestId('toast')).toHaveCount(0);
		await expect(page.getByTestId('toast-quiet')).toContainText('Effort of Research: 3d to 4d');
		await expect(page.getByTestId('toast-quiet')).toHaveAttribute('data-status', 'scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(undo).toBeEnabled();
		await expect(undo).toHaveAccessibleName('Undo: Effort of Research: 3d to 4d');
		await expect(redo).toBeDisabled();
		for (const b of [undo, redo]) {
			const box = await b.boundingBox();
			expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
		}
		await shot(page, 'topbar');

		await undo.click();
		expect(await text(page)).toBe(original);
		await expect(redo).toBeEnabled();
		await expect(redo).toHaveAccessibleName('Redo: Effort of Research: 3d to 4d');
		await redo.click();
		expect(await text(page)).toBe(edited);
		await expect(page.getByTestId('toast')).toHaveCount(0);
	});

	test('the Text tab no longer carries its own undo pair', async ({ page }) => {
		await open(page);
		await page.getByRole('tab', { name: 'Text', exact: true }).click();
		await expect(page.getByTestId('undo')).toHaveCount(1);
		await expect(page.getByTestId('redo')).toHaveCount(1);
	});

	test('a refusal is a compact message under the top bar: it covers nothing, and has Dismiss', async ({
		page,
	}) => {
		await open(page);
		const before = await text(page);
		// The gate already waits on research: the reverse link is a loop.
		const o = await act(page, { type: 'link', pred: 'design.gate', succ: 'design.research' });
		expect(o.status).toBe('refused');
		const toast = page.getByTestId('toast');
		await expect(toast).toHaveCount(1);
		await expect(toast).toContainText('depend on each other in a loop');
		await expect(toast).toHaveAttribute('data-status', 'refused');
		// In the page's flow, between the top bar and the chart: nothing under it is covered.
		const [bar, strip, chart] = await Promise.all([
			page.locator('header.topbar').boundingBox(),
			toast.boundingBox(),
			page.getByTestId('gantt').boundingBox(),
		]);
		expect(bar && strip && chart, 'boxes').toBeTruthy();
		if (bar && strip && chart) {
			expect(strip.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
			expect(chart.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1);
			expect(strip.height).toBeLessThan(100);
		}
		// It does not take the focus, and the text is untouched.
		expect(
			await page.evaluate(() => document.activeElement?.closest('[data-testid="toast"]')),
		).toBe(null);
		expect(await text(page)).toBe(before);
		await shot(page, 'message');
		await toast.getByRole('button', { name: 'Dismiss' }).click();
		await expect(toast).toHaveCount(0);
		// The chart is back where it was.
		const after = await page.getByTestId('gantt').boundingBox();
		expect(after?.y ?? 0).toBeLessThan((chart?.y ?? 0) - 1);
	});

	test('press and hold Undo opens the History; the 3rd line rewinds 3 edits after a confirmation', async ({
		page,
	}) => {
		await open(page);
		const [original, a, b, c] = await edit3(page);
		const redo = page.getByTestId('redo');

		await hold(page, 'undo', 700);
		const sheet = page.getByRole('dialog', { name: 'History' });
		await expect(sheet).toBeVisible();
		// The hold was not an undo.
		expect(await text(page)).toBe(c);
		const entries = sheet.getByTestId('history-entry');
		await expect(entries).toHaveCount(3);
		// Newest first, labelled by what each edit did, with how long ago.
		await expect(entries.nth(0)).toContainText('Effort of Write docs: 2d to 3d');
		await expect(entries.nth(0)).toContainText('Latest');
		await expect(entries.nth(0)).toContainText('just now');
		await expect(entries.nth(2)).toContainText('Effort of Research: 3d to 4d');
		await shot(page, 'history');
		await axe(page, 'history sheet');
		await page.emulateMedia({ colorScheme: 'dark' });
		await axe(page, 'history sheet, dark');
		await page.emulateMedia({ colorScheme: 'light' });

		await entries.nth(2).click();
		const confirm = page.getByRole('dialog', { name: 'Undo the last 3 changes, back to here?' });
		await expect(confirm).toBeVisible();
		await expect(confirm).toContainText('Effort of Research: 3d to 4d');
		// Nothing changes until it is confirmed.
		expect(await text(page)).toBe(c);
		await shot(page, 'confirm');
		await axe(page, 'confirmation');
		await page.emulateMedia({ colorScheme: 'dark' });
		await axe(page, 'confirmation, dark');
		await page.emulateMedia({ colorScheme: 'light' });

		// Cancel keeps the plan and the sheet.
		await confirm.getByRole('button', { name: 'Cancel' }).click();
		await expect(confirm).toBeHidden();
		await expect(sheet).toBeVisible();
		expect(await text(page)).toBe(c);

		await entries.nth(2).click();
		await confirm.getByRole('button', { name: 'Undo 3' }).click();
		await expect(sheet).toBeHidden();
		// Three edits are gone: the text is the original, byte for byte.
		expect(await text(page)).toBe(original);
		await expect(page.getByTestId('toast')).toContainText('Undid 3 changes.');
		await expect(page.getByTestId('undo')).toBeDisabled();

		// Redo steps forward one edit at a time.
		await redo.click();
		expect(await text(page)).toBe(a);
		await redo.click();
		expect(await text(page)).toBe(b);
		await redo.click();
		expect(await text(page)).toBe(c);
		await expect(redo).toBeDisabled();
	});

	test('a keyboard reaches the History: the context menu key, and the status card row', async ({
		page,
	}) => {
		await open(page);
		await edit3(page);
		await page.getByTestId('undo').focus();
		await page.keyboard.press('Shift+F10');
		const sheet = page.getByRole('dialog', { name: 'History' });
		await expect(sheet).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		// Focus is back on Undo.
		await expect(page.getByTestId('undo')).toBeFocused();
		// A plain tap is still one undo.
		await page.getByTestId('undo').click();
		await expect(sheet).toBeHidden();

		await page.getByTestId('status-button').click();
		await page.getByTestId('open-history').click();
		await expect(sheet).toBeVisible();
		await expect(sheet.getByTestId('history-entry')).toHaveCount(2);
	});

	test('the theme choice lives in the status card, with the same three choices', async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await open(page);
		// The top bar has no toggle on a phone.
		await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
		const html = page.locator('html');
		await expect(html).toHaveAttribute('data-theme-pref', 'system');
		await page.getByTestId('status-button').click();
		const group = page.getByRole('group', { name: 'Appearance' });
		await expect(group.getByRole('radio')).toHaveCount(3);
		await expect(group.getByRole('radio', { name: 'System' })).toBeChecked();
		await group.getByRole('radio', { name: 'Dark' }).click();
		await expect(html).toHaveAttribute('data-theme', 'dark');
		await expect(html).toHaveAttribute('data-theme-pref', 'dark');
		await group.getByRole('radio', { name: 'Light' }).click();
		await expect(html).toHaveAttribute('data-theme', 'light');
		await expect(html).toHaveAttribute('data-theme-pref', 'light');
		await page.reload();
		await expect(html).toHaveAttribute('data-theme-pref', 'light');
	});
});

test.describe('desktop keeps its toasts', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name !== 'desktop', 'desktop');
	});
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('an edit shows its toast with Undo, and the theme toggle stays in the top bar', async ({
		page,
	}) => {
		await open(page);
		const original = await text(page);
		expect((await act(page, EDITS[0])).status).toBe('applied');
		const toast = page.getByTestId('toast');
		await expect(toast).toHaveCount(1);
		await expect(toast).toContainText('Effort of Research: 3d to 4d');
		await expect(page.getByTestId('toast-quiet')).toHaveCount(0);
		await expect(page.getByTestId('theme-toggle')).toBeVisible();
		await expect(page.getByTestId('open-history')).toHaveCount(0);
		await toast.getByRole('button', { name: 'Undo' }).click();
		expect(await text(page)).toBe(original);
	});
});

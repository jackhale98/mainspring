// SPDX-License-Identifier: GPL-2.0-or-later
// The edit dispatcher in the built app (phase-2.md 6.8, 9.4; T13). The edit is a real key press
// (Shift+Alt+Right on the focused row, T16); `?hooks=edits` (edit-hooks.ts) only reads. It shows the toast, the patch in the text (the
// editor too in Split on desktop), the engine's reschedule, and Undo in the toast restoring the
// text byte for byte. A newer build is offered (ADR-0012), so the status strip shows its reload
// button: the toast must cover neither (review M2). Desktop Chrome and Pixel 7. With SCREENSHOTS=1
// it writes
// docs/phases/screenshots/phase-2/toast-<project>-<light|dark>.png.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');

interface Hooks {
	action(a: unknown): Promise<{ status: string; entry?: string }>;
	settled: { status: string } | null;
	text(path?: string): string | null;
	end(task: string): number | null;
	revision(): number | null;
}
const hooks = (page: Page) => ({
	action: (a: unknown) =>
		page.evaluate(
			(x) => (window as unknown as { __mainspringEdits: Hooks }).__mainspringEdits.action(x),
			a,
		),
	settled: () =>
		page.evaluate(
			() => (window as unknown as { __mainspringEdits: Hooks }).__mainspringEdits.settled,
		),
	text: () =>
		page.evaluate(() =>
			(window as unknown as { __mainspringEdits: Hooks }).__mainspringEdits.text(),
		),
	end: (task: string) =>
		page.evaluate(
			(t) => (window as unknown as { __mainspringEdits: Hooks }).__mainspringEdits.end(t),
			task,
		),
	revision: () =>
		page.evaluate(() =>
			(window as unknown as { __mainspringEdits: Hooks }).__mainspringEdits.revision(),
		),
});

/** The editor view's own document (the view renders only the lines on screen). */
const viewText = (page: Page) =>
	page.evaluate(() =>
		(
			document.querySelector('.cm-content') as unknown as {
				cmTile: { root: { view: { state: { doc: { toString(): string } } } } };
			}
		).cmTile.root.view.state.doc.toString(),
	);

const desktop = (info: { project: { name: string } }) => info.project.name === 'desktop';

test.describe('a visual edit through the dispatcher', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T13)');
	});
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('shows its toast, reschedules, and Undo restores the text', async ({ page }, info) => {
		const mode = desktop(info) ? 'split' : 'visual';
		// A newer deployed build: the status strip offers a reload.
		await page.route('**/version.json*', (route) =>
			route.fulfill({ json: { id: 'ffffffff-209912312359', builtAt: '2099-12-31T23:59:00Z' } }),
		);
		await page.goto(`/app?sample=gantt-manipulation&mode=${mode}&hooks=edits`);
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		const status = page.getByRole('group', { name: 'Plan status' });
		await expect(status).toContainText('Scheduled', { timeout: READY_TIMEOUT_MS });
		const h = hooks(page);
		await expect.poll(() => h.revision()).not.toBeNull();
		const before = await h.text();
		const end0 = await h.end('design.research');
		const rev0 = await h.revision();
		expect(before).toContain('effort 3d');
		expect(end0).not.toBeNull();

		// R1's keyboard alternative, as a real key press on the focused row (T16): one more unit.
		await page.locator('[role="row"][data-key="task:design.research"]').focus();
		await page.keyboard.press('Shift+Alt+ArrowRight');
		const toast = page.getByTestId('toast');
		await expect(toast).toHaveCount(1);
		await expect(toast).toContainText('Effort of Research: 3d to 4d');
		// The patch is the value token alone.
		expect(await h.text()).toBe(before?.replace('effort 3d', 'effort 4d'));
		// The editor in Split followed the workspace (view.update, not a new state).
		if (desktop(info)) await expect.poll(() => viewText(page)).toBe(await h.text());

		// The engine's result includes the edit: the toast settles and the task ends a day later.
		await expect(toast).toHaveAttribute('data-status', 'scheduled');
		await expect.poll(() => h.revision(), { timeout: READY_TIMEOUT_MS }).toBeGreaterThan(rev0 ?? 0);
		const end1 = await h.end('design.research');
		expect(end1).toBeGreaterThan(end0 ?? 0);
		await expect(status).toContainText('Scheduled');

		// The toast sits above the footer: the status and the reload button stay visible. A phone
		// has no footer: it sits above the tab bar, and the reload is the status button's pip.
		const box = await toast.boundingBox();
		if (desktop(info)) {
			const reload = page.getByRole('button', { name: /new version of Mainspring is available/ });
			await expect(reload).toBeVisible({ timeout: 10_000 });
			for (const covered of [status, reload]) {
				const b = await covered.boundingBox();
				expect(box && b, 'boxes').toBeTruthy();
				if (box && b) expect(box.y + box.height).toBeLessThanOrEqual(b.y);
			}
			const hit = await reload.evaluate((el) => {
				const r = el.getBoundingClientRect();
				return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
			});
			expect(hit, 'nothing is drawn over the reload button').toBe(true);
		} else {
			await expect(page.getByTestId('update-pip')).toBeVisible({ timeout: 10_000 });
			const tabs = await page.locator('.tabbar').boundingBox();
			expect(box && tabs, 'boxes').toBeTruthy();
			if (box && tabs) expect(box.y + box.height).toBeLessThanOrEqual(tabs.y);
		}

		const undo = toast.getByRole('button', { name: 'Undo' });
		await expect(undo).toBeEnabled();
		if (process.env['SCREENSHOTS'] === '1') {
			await page.screenshot({ path: path.join(DIR, `toast-${info.project.name}-light.png`) });
			await page.emulateMedia({ colorScheme: 'dark' });
			await page.waitForTimeout(150);
			await page.screenshot({ path: path.join(DIR, `toast-${info.project.name}-dark.png`) });
			await page.emulateMedia({ colorScheme: 'light' });
		}

		// Undo in the toast: exactly what Mod-Z does. The text is back byte for byte, the toast
		// closes, and the engine schedules the original again.
		await undo.click();
		expect(await h.text()).toBe(before);
		await expect(toast).toHaveCount(0);
		await expect.poll(() => h.end('design.research'), { timeout: READY_TIMEOUT_MS }).toBe(end0);
		if (desktop(info)) await expect.poll(() => viewText(page)).toBe(before);
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
// Regression test (T21): on Android Chrome, CodeMirror (EditContext) holds Enter back until the
// next animation frame, and any transaction dispatched in that frame drops it
// (@codemirror/view `delayAndroidKey`). The app dispatches diagnostics on its own timing, about
// 300 ms after typing stops, which is when people press Enter.
//
// Deterministic: the test controls the page clock (`page.clock`), so animation frames only run when
// told. Enter is pressed (CodeMirror queues its flush for the next frame), then the engine result
// for the previous keystroke arrives from the worker while that frame is still pending, then the
// frame runs. Before the fix the result's diagnostics
// dispatch cleared the held Enter and the line was never inserted. Pixel 7 emulation only.
import { expect, test, type Page } from '@playwright/test';

const READY_TIMEOUT_MS = 120_000;
const PLAN =
	'project p "P" 2026-01-05 +1w\nresource r "R"\ntask a "A" { effort 100d allocate r }\n';
const editor = (page: Page) => page.getByRole('textbox', { name: /^Editor for / });

const lines = (page: Page) =>
	page.evaluate(
		() =>
			(
				document.querySelector('.cm-content') as unknown as {
					cmTile: { root: { view: { state: { doc: { lines: number } } } } };
				}
			).cmTile.root.view.state.doc.lines,
	);

test.describe('Enter while an engine result arrives', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name !== 'pixel-7', 'Android EditContext (Pixel 7 emulation)');
	});
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('the held Enter is not dropped by the result', async ({ page }) => {
		// Requests to the engine worker can be held back and released on demand, so that the result
		// comes after Enter however fast the engine is.
		await page.addInitScript(() => {
			const post = Worker.prototype.postMessage;
			const held: Array<[Worker, unknown[]]> = [];
			let hold = false;
			Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
				if (hold) held.push([this, args]);
				else (post as (...a: unknown[]) => void).apply(this, args);
			} as typeof Worker.prototype.postMessage;
			Object.assign(window, {
				__hold: (on: boolean) => {
					hold = on;
					if (on) return;
					for (const [w, a] of held.splice(0)) (post as (...a: unknown[]) => void).apply(w, a);
				},
			});
		});
		await page.goto('/app?sample=syn-18-structure-include-macro');
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		// A plan with engine problems, so that the next result changes what is drawn (the marks
		// turn from stale to current). With nothing drawn, an empty push is skipped and the guard
		// is never exercised.
		await editor(page).tap();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.insertText(PLAN);
		await expect(page.locator('.cm-lintRange-error').first()).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('3 warnings', {
			timeout: READY_TIMEOUT_MS,
		});
		// The page clock is ours from here: timers and animation frames run only when told, so the
		// frame that flushes Enter is still pending when the engine result arrives from its worker.
		await page.clock.install();
		await page.clock.pauseAt(Date.now() + 10_000);
		await page.evaluate(() =>
			(window as unknown as { __hold: (on: boolean) => void }).__hold(true),
		);
		await page.keyboard.press('#');
		// The runner's 300 ms debounce passes; the run starts.
		await page.clock.runFor(400);
		const state = page.getByRole('group', { name: 'Plan status' }).locator('.state');
		await expect(state).toHaveAttribute('data-kind', 'scheduling', { timeout: 10_000 });
		const before = await lines(page);
		await page.keyboard.press('Enter');
		expect(
			await page.evaluate(
				() =>
					!!(
						document.querySelector('.cm-content') as unknown as {
							cmTile: { root: { view: { observer: { delayedAndroidKey?: unknown } } } };
						}
					).cmTile.root.view.observer.delayedAndroidKey,
			),
			'CodeMirror holds Enter until the next frame',
		).toBe(true);
		// The run goes to the worker now, and its result reaches the editor while Enter is held.
		await page.evaluate(() =>
			(window as unknown as { __hold: (on: boolean) => void }).__hold(false),
		);
		await expect(state).not.toHaveAttribute('data-kind', 'scheduling', {
			timeout: READY_TIMEOUT_MS,
		});
		await page.waitForTimeout(200);
		await page.clock.runFor(100);
		await page.waitForTimeout(300);
		expect(await lines(page), 'the Enter was applied').toBe(before + 1);
		// And the result's diagnostics did arrive afterwards: the marks are current again.
		await expect(page.locator('.cm-tjp-stale')).toHaveCount(0);
	});
});

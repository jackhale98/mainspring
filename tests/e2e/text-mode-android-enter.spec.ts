// SPDX-License-Identifier: GPL-2.0-or-later
// Regression test (T21): on Android Chrome, CodeMirror (EditContext) holds Enter back until the
// next animation frame, and any transaction dispatched before that frame drops it
// (@codemirror/view `delayAndroidKey`). The app dispatches diagnostics on its own timing: since
// T8 (phase-2.md 6.9) the schedule runner shows an engine result in an idle task after it
// arrives, and `requestIdleCallback` can run in the idle time before the next frame, which is
// exactly while Enter is held. The guard (lint.ts `push`, `androidKeyPending`) defers every
// diagnostics dispatch until the key is flushed.
//
// Deterministic: the test controls the page clock (`page.clock`), so timers, idle callbacks and
// animation frames run only when told, and it holds back animation frames itself, so the frame
// that flushes Enter runs only after the runner's idle tasks have shown the result:
// 1. a keystroke; the runner's debounce passes and the run goes to the worker, which the test
//    holds back;
// 2. Enter (CodeMirror queues its flush for the next frame, which the test holds);
// 3. the run is released; the test waits until the page has received the result;
// 4. the clock runs: the runner's idle tasks show the result and its diagnostics reach the editor
//    while Enter is still held;
// 5. the held frame runs: Enter must land, and the diagnostics follow.
// With the guard disabled, step 4 dispatches into the editor and Enter is lost. Pixel 7 only.
import { expect, test, type Page } from '@playwright/test';

const READY_TIMEOUT_MS = 120_000;
const PLAN =
	'project p "P" 2026-01-05 +1w\nresource r "R"\ntask a "A" { effort 100d allocate r }\n';
const editor = (page: Page) => page.getByRole('textbox', { name: /^Editor for / });

type View = {
	state: { doc: { lines: number } };
	observer: { delayedAndroidKey?: unknown };
};
const view = (): View =>
	(document.querySelector('.cm-content') as unknown as { cmTile: { root: { view: View } } }).cmTile
		.root.view;

const lines = (page: Page) =>
	page.evaluate(`(${view.toString()})().state.doc.lines`) as Promise<number>;
const enterHeld = (page: Page) =>
	page.evaluate(`!!(${view.toString()})().observer.delayedAndroidKey`) as Promise<boolean>;

interface Hooks {
	/** Holds worker requests back (true), or sends the held ones (false). */
	__hold(on: boolean): void;
	/** Holds animation frames back (true), or runs the held ones (false). */
	__frames(on: boolean): void;
	/** Engine results the page has received. */
	__received: number;
}
const hooks = (page: Page) => ({
	hold: (on: boolean) => page.evaluate((v) => (window as unknown as Hooks).__hold(v), on),
	frames: (on: boolean) => page.evaluate((v) => (window as unknown as Hooks).__frames(v), on),
	received: () => page.evaluate(() => (window as unknown as Hooks).__received),
});

test.describe('Enter while an engine result arrives', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name !== 'pixel-7', 'Android EditContext (Pixel 7 emulation)');
	});
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('the held Enter is not dropped by the result', async ({ page }) => {
		// Requests to the engine worker can be held back and released on demand, so that the result
		// comes after Enter however fast the engine is; results the page receives are counted.
		await page.addInitScript(() => {
			const post = Worker.prototype.postMessage;
			const held: Array<[Worker, unknown[]]> = [];
			let hold = false;
			Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
				if (hold) held.push([this, args]);
				else (post as (...a: unknown[]) => void).apply(this, args);
			} as typeof Worker.prototype.postMessage;
			const listen = Worker.prototype.addEventListener;
			Worker.prototype.addEventListener = function (
				this: Worker,
				type: string,
				l: EventListenerOrEventListenerObject,
				o?: boolean | AddEventListenerOptions,
			) {
				if (type === 'message' && typeof l === 'function') {
					const counted = function (this: Worker, e: Event) {
						if (((e as MessageEvent).data as { type?: string } | null)?.type === 'scheduled') {
							(window as unknown as { __received: number }).__received++;
						}
						return l.call(this, e);
					};
					return listen.call(this, type, counted, o);
				}
				return listen.call(this, type, l, o);
			} as typeof Worker.prototype.addEventListener;
			Object.assign(window, {
				__received: 0,
				__hold: (on: boolean) => {
					hold = on;
					if (on) return;
					for (const [w, a] of held.splice(0)) (post as (...a: unknown[]) => void).apply(w, a);
				},
			});
		});
		await page.goto('/app?sample=syn-18-structure-include-macro&mode=text');
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
		// The page clock is ours from here: timers, idle callbacks and animation frames run only
		// when told. Frames can also be held back while the clock runs (installed after the clock,
		// so that it wraps the clock's own requestAnimationFrame).
		await page.clock.install();
		await page.clock.pauseAt(Date.now() + 10_000);
		await page.evaluate(() => {
			const raf = window.requestAnimationFrame.bind(window);
			const held: FrameRequestCallback[] = [];
			let hold = false;
			window.requestAnimationFrame = (fn: FrameRequestCallback) => {
				if (!hold) return raf(fn);
				held.push(fn);
				return 0;
			};
			Object.assign(window, {
				__frames: (on: boolean) => {
					hold = on;
					if (on) return;
					for (const fn of held.splice(0)) fn(performance.now());
				},
			});
		});
		const h = hooks(page);
		await h.hold(true);
		await page.keyboard.press('#');
		// The runner's 300 ms debounce passes; the run starts (held at the worker).
		await page.clock.runFor(400);
		const state = page.getByRole('group', { name: 'Plan status' }).locator('.state');
		await expect(state).toHaveAttribute('data-kind', 'scheduling', { timeout: 10_000 });
		const before = await lines(page);
		const received = await h.received();
		// Enter: CodeMirror holds it until the next frame, which the test holds too.
		await h.frames(true);
		await page.keyboard.press('Enter');
		expect(await enterHeld(page), 'CodeMirror holds Enter until the next frame').toBe(true);
		// The run goes to the worker; wait until its result has reached the page.
		await h.hold(false);
		await expect.poll(() => h.received(), { timeout: READY_TIMEOUT_MS }).toBeGreaterThan(received);
		// The runner's idle tasks show the result while Enter is held: its diagnostics are pushed
		// to the editor now (the guard defers them; without it they would drop the key).
		await page.clock.runFor(300);
		await expect(state).not.toHaveAttribute('data-kind', 'scheduling');
		expect.soft(await enterHeld(page), 'Enter is still held while the result is shown').toBe(true);
		// The held frame runs: CodeMirror flushes Enter; then the deferred diagnostics follow.
		await h.frames(false);
		await page.clock.runFor(100);
		expect(await lines(page), 'the Enter was applied').toBe(before + 1);
		// And the result's diagnostics did arrive afterwards: the marks are current again.
		await expect(page.locator('.cm-tjp-stale')).toHaveCount(0);
	});
});

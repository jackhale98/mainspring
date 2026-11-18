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
// With the guard disabled, step 4 dispatches into the editor and Enter is lost.
//
// Both phone projects run these tests; what holds Enter back differs, and the test holds it the way
// the device does (`Held`):
// - Pixel 7 (Chromium, Android): the frame that flushes Enter, held by the test. Real key presses.
// - iPhone 14 (WebKit, iOS): there is no EditContext and no frame wait. CodeMirror lets the browser
//   insert the newline and replays the key from `applyDOMChange` (`pendingIOSKey`), with a 50 ms
//   timer as the fallback when no DOM change follows. A real key press is therefore handled in the
//   task of the key itself, and no result can arrive in between. The window exists for the fallback:
//   a keydown that has no default action (an untrusted event) sets `pendingIOSKey` and waits for the
//   timer, which the test holds back. That is the stand-in; the third test presses a real Enter on
//   both devices. The Android-only step (`delayedAndroidKey`, the visual edit waiting for the key)
//   is checked on the Pixel 7 only: the dispatcher does not wait for an iOS key (see the second
//   test), what is checked on both is that nothing is lost.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { isIphone, isTouch } from './lib/gantt-rig';
import { modKey } from './lib/keys';

const READY_TIMEOUT_MS = 120_000;
const PLAN =
	'project p "P" 2026-01-05 +1w\nresource r "R"\ntask a "A" { effort 100d allocate r }\n';
const editor = (page: Page) => page.getByRole('textbox', { name: /^Editor for / });

type View = {
	state: { doc: { lines: number } };
	observer: { delayedAndroidKey?: unknown };
	inputState: { pendingIOSKey?: unknown };
};
const view = (): View =>
	(document.querySelector('.cm-content') as unknown as { cmTile: { root: { view: View } } }).cmTile
		.root.view;

const lines = (page: Page) =>
	page.evaluate(`(${view.toString()})().state.doc.lines`) as Promise<number>;
const androidHeld = (page: Page) =>
	page.evaluate(`!!(${view.toString()})().observer.delayedAndroidKey`) as Promise<boolean>;
const iosHeld = (page: Page) =>
	page.evaluate(`!!(${view.toString()})().inputState.pendingIOSKey`) as Promise<boolean>;

/** CodeMirror's fallback timer for a pending iOS key (`flushIOSKey`, @codemirror/view). */
const IOS_FLUSH_MS = 50;

interface Hooks {
	/** Holds worker requests back (true), or sends the held ones (false). */
	__hold(on: boolean): void;
	/** Holds animation frames back (true), or runs the held ones (false). */
	__frames(on: boolean): void;
	/** Holds the timer that flushes a pending iOS key (true), or runs the held ones (false). */
	__keyTimer(on: boolean): void;
	/** How many flush timers are held. */
	__keyTimers(): number;
	/** Engine results the page has received. */
	__received: number;
}
const hooks = (page: Page) => ({
	hold: (on: boolean) => page.evaluate((v) => (window as unknown as Hooks).__hold(v), on),
	frames: (on: boolean) => page.evaluate((v) => (window as unknown as Hooks).__frames(v), on),
	keyTimer: (on: boolean) => page.evaluate((v) => (window as unknown as Hooks).__keyTimer(v), on),
	keyTimers: () => page.evaluate(() => (window as unknown as Hooks).__keyTimers()),
	received: () => page.evaluate(() => (window as unknown as Hooks).__received),
});

const status = (page: Page) => page.getByRole('group', { name: 'Plan status' });

/** Requests to the worker can be held back and released; results the page receives are counted. */
async function holdableWorker(page: Page): Promise<void> {
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
}

async function ready(page: Page, url: string): Promise<void> {
	await page.goto(url);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(status(page)).toContainText('Scheduled', { timeout: READY_TIMEOUT_MS });
}

/**
 * The page clock is ours from here: timers, idle callbacks and animation frames run only when told.
 * Frames (Android's flush) and the 50 ms timer of a pending iOS key (iOS's) can also be held back
 * while the clock runs; installed after the clock, so that they wrap the clock's own functions.
 */
async function takeClock(page: Page): Promise<void> {
	await page.clock.install();
	await page.clock.pauseAt(Date.now() + 10_000);
	await page.evaluate((flushMs) => {
		const raf = window.requestAnimationFrame.bind(window);
		const frames: FrameRequestCallback[] = [];
		let holdFrames = false;
		window.requestAnimationFrame = (fn: FrameRequestCallback) => {
			if (!holdFrames) return raf(fn);
			frames.push(fn);
			return 0;
		};
		const timeout = window.setTimeout.bind(window);
		const timers: Array<() => void> = [];
		let holdTimers = false;
		window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
			if (holdTimers && ms === flushMs && typeof fn === 'function') {
				timers.push(fn as () => void);
				return 0;
			}
			return timeout(fn, ms, ...rest);
		}) as typeof window.setTimeout;
		Object.assign(window, {
			__frames: (on: boolean) => {
				holdFrames = on;
				if (on) return;
				for (const fn of frames.splice(0)) fn(performance.now());
			},
			__keyTimer: (on: boolean) => {
				holdTimers = on;
				if (on) return;
				for (const fn of timers.splice(0)) fn();
			},
			__keyTimers: () => timers.length,
		});
	}, IOS_FLUSH_MS);
}

/**
 * Enter held back the way this device holds it (see the header). `press` returns with the key held;
 * `release` lets it through.
 */
function heldEnter(page: Page, info: TestInfo) {
	const h = hooks(page);
	const ios = isIphone(info);
	return {
		ios,
		what: ios
			? 'CodeMirror holds the iOS key until its flush timer'
			: 'CodeMirror holds Enter until the next frame',
		isHeld: () => (ios ? iosHeld(page) : androidHeld(page)),
		async press(): Promise<void> {
			if (!ios) {
				await h.frames(true);
				await page.keyboard.press('Enter');
				return;
			}
			// An untrusted keydown has no default action, so no DOM change follows and the key waits for
			// CodeMirror's flush timer, which is held.
			await h.keyTimer(true);
			await page.evaluate(() => {
				const e = new KeyboardEvent('keydown', {
					key: 'Enter',
					code: 'Enter',
					keyCode: 13,
					which: 13,
					bubbles: true,
					cancelable: true,
				});
				if (e.keyCode !== 13) Object.defineProperty(e, 'keyCode', { get: () => 13 });
				document.querySelector('.cm-content')?.dispatchEvent(e);
			});
			expect(await h.keyTimers(), 'the key waits for its flush timer, which is held').toBe(1);
		},
		release: () => (ios ? h.keyTimer(false) : h.frames(false)),
	};
}

test.describe('Enter while an engine result arrives', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(
			!isTouch(info),
			'a phone keyboard; the desktop has neither the Android nor the iOS key path',
		);
	});
	test.setTimeout(READY_TIMEOUT_MS * 2);

	/**
	 * A plan with engine problems, so that the next result changes what is drawn (the marks turn from
	 * stale to current; with nothing drawn, an empty push is skipped and the guard is never
	 * exercised). Then the clock is ours and a run is on its way to the worker, held there.
	 */
	async function runInFlight(page: Page) {
		await holdableWorker(page);
		await ready(page, '/app?sample=syn-18-structure-include-macro&mode=text');
		const mod = await modKey(page);
		await editor(page).tap();
		await page.keyboard.press(`${mod}+a`);
		await page.keyboard.insertText(PLAN);
		await expect(page.locator('.cm-lintRange-error').first()).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});
		await expect(status(page)).toContainText('3 warnings', { timeout: READY_TIMEOUT_MS });
		await takeClock(page);
		const h = hooks(page);
		await h.hold(true);
		await page.keyboard.press('#');
		// The runner's 300 ms debounce passes; the run starts (held at the worker).
		await page.clock.runFor(400);
		const state = status(page).locator('.state');
		await expect(state).toHaveAttribute('data-kind', 'scheduling', { timeout: 10_000 });
		return { h, state, before: await lines(page), received: await h.received() };
	}

	test('the held Enter is not dropped by the result', async ({ page }, info) => {
		const { h, state, before, received } = await runInFlight(page);
		// Enter, held (Android: until the next frame; iOS: until the flush timer).
		const key = heldEnter(page, info);
		await key.press();
		expect(await key.isHeld(), key.what).toBe(true);
		// The run goes to the worker; wait until its result has reached the page.
		await h.hold(false);
		await expect.poll(() => h.received(), { timeout: READY_TIMEOUT_MS }).toBeGreaterThan(received);
		// The runner's tasks show the result while Enter is held: its diagnostics are pushed to the
		// editor now (the guard defers them on Android; without it they would drop the key).
		await page.clock.runFor(300);
		await expect(state).not.toHaveAttribute('data-kind', 'scheduling');
		expect.soft(await key.isHeld(), 'Enter is still held while the result is shown').toBe(true);
		// The held key goes through: CodeMirror flushes Enter; then the deferred diagnostics follow.
		await key.release();
		await page.clock.runFor(100);
		expect(await lines(page), 'the Enter was applied').toBe(before + 1);
		// And the result's diagnostics did arrive afterwards: the marks are current again.
		await expect(page.locator('.cm-tjp-stale')).toHaveCount(0);
	});

	// The key as a person types it, on both phones: nothing is held, the result arrives while the key
	// is handled by whatever path the device takes.
	test('a typed Enter is applied when the result arrives', async ({ page }) => {
		const { h, state, before, received } = await runInFlight(page);
		await page.keyboard.press('Enter');
		await h.hold(false);
		await expect.poll(() => h.received(), { timeout: READY_TIMEOUT_MS }).toBeGreaterThan(received);
		await page.clock.runFor(300);
		expect(await lines(page), 'the Enter was applied').toBe(before + 1);
		// The Enter is an edit like any other: its own run follows (the first result was for the text
		// before it) and settles, with the marks current.
		await expect
			.poll(
				async () => {
					await page.clock.runFor(350);
					return state.getAttribute('data-kind');
				},
				{ timeout: READY_TIMEOUT_MS },
			)
			.not.toBe('scheduling');
		await expect(page.locator('.cm-tjp-stale')).toHaveCount(0);
		expect(await lines(page), 'and it stayed').toBe(before + 1);
	});

	// T13 (phase-2.md 6.8): a visual edit dispatched while Enter is held. On Android the dispatcher's
	// gate waits until CodeMirror has handled the key, then plans again on the text with the newline
	// (the version moved) and applies; the editor follows with view.update. Without the gate the edit
	// lands in the shown file while the key is held and the Enter is lost. An iOS key is not part of
	// the document state (CodeMirror replays it through the key handlers), so the dispatcher does not
	// wait for it; there the check is that the edit does not drop the pending key, and both land.
	test('a visual edit dispatched while Enter is held waits for it', async ({ page }, info) => {
		await ready(page, '/app?sample=gantt-manipulation&mode=text&hooks=edits');
		type Edits = { action(a: unknown): Promise<{ status: string }>; text(): string };
		const text = () =>
			page.evaluate(() =>
				(window as unknown as { __mainspringEdits: Edits }).__mainspringEdits.text(),
			);
		const mod = await modKey(page);
		await editor(page).tap();
		await page.keyboard.press(`${mod}+Home`);
		await takeClock(page);
		const before = await lines(page);
		const original = await text();
		const key = heldEnter(page, info);
		await key.press();
		expect(await key.isHeld(), key.what).toBe(true);
		// The intent is dispatched now; the page does not wait for it (its gate runs on the clock).
		await page.evaluate(() => {
			const w = window as unknown as { __mainspringEdits: Edits; __dispatched: unknown };
			w.__dispatched = null;
			void w.__mainspringEdits
				.action({ type: 'size-step', task: 'design.research', steps: 1 })
				.then((o) => (w.__dispatched = o.status));
		});
		await page.clock.runFor(100);
		expect(await key.isHeld(), 'the edit did not drop the held key').toBe(true);
		if (!key.ios) expect(await text(), 'the edit waits while Enter is held').toBe(original);
		// The held key goes through: Enter lands; then the gate lets the edit through.
		await key.release();
		await page.clock.runFor(100);
		await expect
			.poll(() =>
				page.evaluate(() => (window as unknown as { __dispatched: unknown }).__dispatched),
			)
			.toBe('applied');
		expect(await lines(page), 'the Enter was applied').toBe(before + 1);
		const after = await text();
		expect(after).toContain('effort 4d');
		expect(after.replace('effort 4d', 'effort 3d')).toBe('\n' + original);
	});
});

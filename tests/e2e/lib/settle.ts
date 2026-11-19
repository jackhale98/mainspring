// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Waits for observable state, to replace fixed waits (scripts/ci/fixed-waits.mjs
 * counts what is left). A fixed wait is right on a fast Chromium and too short on a WebKit runner that
 * is three to five times slower; these wait for the thing itself: frames drawn, a box that holds still,
 * animations that have ended, a value that stopped changing. None has a time of its own beyond a
 * generous cap, which only turns a hang into a failure that says what never settled.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** A cap on one wait, so that a thing that never settles (an app bug) fails by name. */
const CAP_MS = 20_000;

/** Waits for `n` animation frames to be drawn by the page (not milliseconds: a slow runner draws fewer). */
export const frames = (page: Page, n = 2): Promise<void> =>
	page.evaluate(
		(count) =>
			new Promise<void>((resolve) => {
				let left = count;
				const tick = (): void => {
					if (--left <= 0) resolve();
					else requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}),
		n,
	);

/**
 * Waits until the page's own `read` returns the same value on `n` consecutive frames and gives it.
 * `read` runs in the page: it may use only its own scope, `window` and `arg` (serialised). A value that never holds still
 * (an app that keeps re-laying out) fails after the cap, saying so.
 */
export async function settledValue<T, A = undefined>(
	page: Page,
	read: (arg: A) => T,
	n = 4,
	arg?: A,
): Promise<T> {
	const r = await page.evaluate(
		({ src, count, cap, arg }) =>
			new Promise<{ ok: boolean; value: unknown }>((resolve) => {
				const fn = new Function(`return (${src})`)() as (a: unknown) => unknown;
				const t0 = performance.now();
				let last = '';
				let value: unknown;
				let same = 0;
				const tick = (): void => {
					value = fn(arg);
					const key = JSON.stringify(value) ?? 'undefined';
					same = key === last ? same + 1 : 0;
					last = key;
					if (same >= count) resolve({ ok: true, value });
					else if (performance.now() - t0 > cap) resolve({ ok: false, value });
					else requestAnimationFrame(tick);
				};
				tick();
			}),
		{ src: read.toString(), count: n, cap: CAP_MS, arg },
	);
	if (!r.ok)
		throw new Error(`the value never held still for ${n} frames: ${JSON.stringify(r.value)}`);
	return r.value as T;
}

/**
 * The element's box holds still for `n` frames (to a tenth of a pixel): a card that is placed a frame
 * or two after it opens, a panel that has finished its slide, a pane that has finished laying out.
 * Reads the layout box, so it also catches a transform that is still moving.
 */
export async function boxStable(target: Locator, n = 4): Promise<void> {
	const ok = await target.evaluate(
		(el, { count, cap }) =>
			new Promise<boolean>((resolve) => {
				const t0 = performance.now();
				let last = '';
				let same = 0;
				const tick = (): void => {
					// A detached element is not still: keep waiting (it may be mounted again), or fail at the cap.
					const r = el.isConnected ? el.getBoundingClientRect() : null;
					const key = r ? [r.x, r.y, r.width, r.height].map((v) => v.toFixed(1)).join(',') : null;
					same = key !== null && key === last ? same + 1 : 0;
					last = key ?? '';
					if (same >= count) resolve(true);
					else if (performance.now() - t0 > cap) resolve(false);
					else requestAnimationFrame(tick);
				};
				tick();
			}),
		{ count: n, cap: CAP_MS },
	);
	expect(ok, 'the box holds still').toBe(true);
}

/**
 * Every finite animation and transition in the page has ended (`document.getAnimations()`), then
 * `after` more frames are drawn, so that what the end of a slide changes (a height, a class) is
 * painted and recorded. An animation that is only starting counts (`pending`), so call it after the
 * thing that starts the animation, not before. Infinite animations (a spinner) are ignored.
 */
export async function animationsDone(page: Page, after = 2): Promise<void> {
	await page.waitForFunction(
		() =>
			document.getAnimations().every((a) => {
				if (a.playState !== 'running' && !a.pending) return true;
				return a.effect?.getComputedTiming().iterations === Infinity;
			}),
		undefined,
		{ timeout: CAP_MS },
	);
	if (after > 0) await frames(page, after);
}

/**
 * A panel (a sheet, a drawer, a card) at rest: its animations have ended and its box holds still.
 * Call it once the state that moves it is visible (a `data-detent`, `aria-expanded`, `toBeVisible`).
 */
export async function panelSettled(panel: Locator, n = 3): Promise<void> {
	const page = panel.page();
	await animationsDone(page, 1);
	await boxStable(panel, n);
	// The end of a glide (a shrink takes its new height in the frame the slide ends) may start another.
	await animationsDone(page, 0);
}

/**
 * The engine is ready and the plan shows as scheduled. Right after an edit this may still be the
 * result BEFORE it: wait for `resultAfter` first when the edit's result is read.
 */
export async function engineIdle(page: Page, timeout = 120_000): Promise<void> {
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', { timeout });
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout,
	});
}

/**
 * The revision of the newest good schedule result (the `edits` hook, so the page needs
 * `hooks=edits`; 0 without it). Read it BEFORE an edit and pass it to `resultAfter`.
 */
export const resultRevision = (page: Page): Promise<number> =>
	page.evaluate(
		() =>
			(
				window as unknown as { __mainspringEdits?: { revision(): number | null } }
			).__mainspringEdits?.revision() ?? 0,
	);

/**
 * The result of an edit is in: a good schedule newer than `rev`, the revision read before the edit.
 * "Scheduled" and "Engine: Ready" are not that: they still show the result BEFORE the edit until its
 * run starts (the debounce of typing, or the defer and paint of a dispatched edit), so a read of
 * the schedule, the heatmap, the findings or the cells after them may be of the old result. Use this
 * before reading anything the schedule derives. Its limit: only a good result counts, so an edit
 * that leaves the plan unschedulable never satisfies it (wait for the strip's own error then).
 */
export async function resultAfter(page: Page, rev: number, timeout = 120_000): Promise<void> {
	await expect
		.poll(() => resultRevision(page), { timeout, message: `a schedule result newer than ${rev}` })
		.toBeGreaterThan(rev);
}

/**
 * First paint is over: the engine is idle, the fonts are in (a canvas that is drawn before them is
 * drawn again), no animation is running, and a few frames have been drawn. What the specs used to
 * wait 500 ms for after the first row appeared.
 */
export async function appSettled(page: Page): Promise<void> {
	await engineIdle(page);
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	await animationsDone(page, 3);
}

/**
 * The Gantt and its table hold still: the table pane's and the chart's boxes, both scroll positions
 * and the table divider's value are the same for `n` frames. A divider drag or key, a scroll, a
 * font-size or window change, a reload that restores a width: wait for the layout that follows.
 * Needs no hook, so it works on every `/app` page that shows the Gantt.
 */
export const ganttSettled = (page: Page, n = 4): Promise<string> =>
	settledValue(
		page,
		() => {
			const q = (s: string): Element | null => document.querySelector(s);
			const box = (e: Element | null): string => {
				if (!e) return '-';
				const b = e.getBoundingClientRect();
				return [b.x, b.y, b.width, b.height].map((v) => v.toFixed(1)).join(',');
			};
			const scroller = q('[data-testid="gantt"] .scroller');
			const body = q('[data-testid="gantt-treegrid"] .body-scroll');
			return [
				box(q('[data-testid="gantt"] .names')),
				box(q('[data-testid="gantt-overlay"]')),
				scroller?.scrollLeft,
				scroller?.scrollTop,
				body?.scrollLeft,
				body?.scrollTop,
				q('[role="separator"][aria-valuenow]')?.getAttribute('aria-valuenow'),
			].join('|');
		},
		n,
	);

/**
 * Positive sync point for a "nothing happens" check: the engine is idle, then `n` frames are drawn
 * after the event, so that anything the event would have started (a re-render, an edit's dispatch,
 * a toast) has had its turn. The negative assertion follows.
 *
 * Its limit: right after a drop the status still reads "Scheduled" from before (an edit goes out
 * after a defer and a paint: edits.svelte.ts, edits-yield.ts), so `engineIdle` may return at once and
 * only the frames sync. That is enough for an edit sent at once (a drop, a Cancel). It is NOT enough
 * for a coalesced edit (COALESCE_MS, 300 ms, edits.svelte.ts) or a keyboard nudge burst (1200 ms,
 * nudge.ts): a test of those needs the state of the edit itself (the text, a toast, the revision).
 */
export async function quietAfter(page: Page, n = 8): Promise<void> {
	// Short on purpose: a wrong edit that does not schedule must fail here, not after 120 s.
	await engineIdle(page, 15_000);
	await frames(page, n);
}

/**
 * The page's idle work has had its turns: `n` idle callbacks in a row (a frame, where the browser has
 * no `requestIdleCallback`: WebKit), each asked for after the last has run, with a short cap each so that a
 * busy page still moves on. For what the app does in idle time and shows nowhere (the text index
 * and its checks run as a chain of idle tasks, schedule-runner.ts): a "nothing changes while the
 * index catches up" check waits for this, not for a time, then reads. It counts turns, so a slow
 * runner (whose idle turns come later) waits longer, and a fast one does not.
 */
export const idleTurns = (page: Page, n = 20): Promise<void> =>
	page.evaluate(
		(count) =>
			new Promise<void>((resolve) => {
				let left = count;
				const turn = (): void => {
					if (left-- <= 0) resolve();
					else if (typeof requestIdleCallback === 'function')
						requestIdleCallback(turn, { timeout: 120 });
					else requestAnimationFrame(turn);
				};
				turn();
			}),
		n,
	);

/**
 * A picture can be taken: the fonts are in (a canvas drawn before them is drawn again), every
 * finite animation and transition has ended, and the Gantt layout (when the page shows one; a
 * page without one reads the same dashes) and scroll positions hold still for a few frames, and no
 * schedule is being computed (where the page has a plan status). What
 * the screenshot specs waited 150 to 1000 ms for after a scheme change, a scroll or a tap.
 */
export async function pictureReady(page: Page): Promise<void> {
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	// A schedule that is being computed (an edit just made) is not a picture: its numbers are about to change.
	const state = page.getByRole('group', { name: 'Plan status' }).locator('.state');
	if ((await state.count()) > 0)
		await expect(state).not.toHaveAttribute('data-kind', 'scheduling', { timeout: 120_000 });
	await animationsDone(page, 2);
	await ganttSettled(page);
}

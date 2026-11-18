// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A finger for the specs that Playwright's `tap()` cannot express: a hold and a swipe. On Chromium
 * (Pixel 7) they are real touch events through CDP. Playwright has no touch input in WebKit, so on
 * the iPhone 14 they are the events the page listens to, dispatched on the element: Pointer Events
 * (`pointerType: 'touch'`), a `touchmove` and, after a release, the `click` a finger leaves
 * behind. What the app does with them is the same code; what is not tested there is the browser's
 * own touch-to-pointer step. Not an allowlist case (ADR-0016): the gesture is still tested.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export const isWebKit = (page: Page): boolean =>
	page.context().browser()?.browserType().name() === 'webkit';

/** Holds a finger on the centre of `target` for `ms`, then lifts it (a tap follows, as on a phone). */
export async function holdFinger(page: Page, target: Locator, ms = 700): Promise<void> {
	if (isWebKit(page)) {
		await target.evaluate(async (el, hold) => {
			const r = el.getBoundingClientRect();
			const at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
			const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, ...at };
			el.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
			await new Promise((done) => setTimeout(done, hold));
			el.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
			el.dispatchEvent(new MouseEvent('click', { ...at, bubbles: true, cancelable: true }));
		}, ms);
		return;
	}
	const box = await target.boundingBox();
	if (!box) throw new Error('nothing to hold');
	const p = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
	await page.waitForTimeout(ms);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
}

/**
 * A finger dragged down 60 px starting `inset` px inside the left edge of `target`: a press and a
 * drag where `target` itself (not something inside it) is under the finger.
 */
export async function swipeOn(page: Page, target: Locator, inset = 3): Promise<void> {
	if (isWebKit(page)) {
		await target.evaluate((el, x) => {
			const r = el.getBoundingClientRect();
			const at = { clientX: r.x + x, clientY: r.y + r.height / 2 };
			const init = { pointerId: 8, pointerType: 'touch', isPrimary: true, bubbles: true };
			el.dispatchEvent(new PointerEvent('pointerdown', { ...init, ...at, buttons: 1 }));
			const move = { bubbles: true, cancelable: true };
			el.dispatchEvent(
				typeof TouchEvent === 'function'
					? new TouchEvent('touchmove', move)
					: new Event('touchmove', move),
			);
			el.dispatchEvent(
				new PointerEvent('pointerup', { ...init, ...at, clientY: at.clientY + 60, buttons: 0 }),
			);
		}, inset);
		return;
	}
	const box = await target.boundingBox();
	if (!box) throw new Error('nothing to swipe on');
	const x = box.x + inset;
	const y = box.y + box.height / 2;
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x, y, id: 1 }],
	});
	for (let i = 1; i <= 6; i++)
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x, y: y + 10 * i, id: 1 }],
		});
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
}

/**
 * Opens the History from Undo as a person does on this browser: on Chromium the menu key
 * (Shift+F10) with Undo focused; iOS sends no `contextmenu` for it, nor for a long press, so on the
 * iPhone it is the press and hold, which is what a finger does there.
 */
export async function openHistoryFromUndo(page: Page): Promise<void> {
	const undo = page.getByTestId('undo');
	await undo.focus();
	if (isWebKit(page)) await holdFinger(page, undo);
	else await page.keyboard.press('Shift+F10');
}

/**
 * A static CSS check of a one-finger pan, for the browsers where dispatched events cannot start one
 * (WebKit: Playwright has no touch drag there; whether the page also cancels the touch is checked
 * by `Rig.takePreventedTouchmoves`): the effective `touch-action` at the point, on the
 * element and its ancestors up to the chart's scroller. A value other than `auto` narrows what the
 * browser may do with a finger below it, so every one of them must let one finger pan both ways,
 * and the chart declares that.
 */
export async function expectBrowserPans(page: Page, at: { x: number; y: number }): Promise<void> {
	const chain = await page.evaluate(({ x, y }) => {
		const out: string[] = [];
		for (let e = document.elementFromPoint(x, y); e; e = e.parentElement) {
			out.push(getComputedStyle(e).touchAction);
			if (e.classList.contains('scroller')) break;
		}
		return out;
	}, at);
	const narrowing = chain.filter((a) => a !== 'auto' && a !== 'pan-x pan-y');
	expect(narrowing, 'touch-action under the finger leaves a one-finger pan to the browser').toEqual(
		[],
	);
	expect(chain, 'the chart declares one-finger panning in its touch-action').toContain(
		'pan-x pan-y',
	);
}

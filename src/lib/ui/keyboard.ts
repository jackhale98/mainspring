// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The touch keyboard and the sheets that open over it. On a phone the on-screen keyboard shrinks the
 * visual viewport but not the layout viewport that a `position: fixed` sheet is placed in, so a
 * sheet opened while the keyboard is up (the docs button, pressed while the editor has the focus)
 * first appears above the keyboard, part way up the screen, and drops to the foot when the keyboard
 * goes. `settleKeyboard` lets the keyboard go first: it blurs the editable element that holds it and
 * resolves once the visual viewport is back to full height (or after a short wait), so that the
 * sheet opens, and slides in, at its final place.
 */

/** What of the browser's viewports the rules read; the test gives its own. */
export interface ViewportView {
	/** The layout viewport's height (`window.innerHeight`). */
	innerHeight: number;
	/** The visual viewport (`window.visualViewport`), if the browser has one. */
	visual: { height: number; scale: number } | null;
}

/** A keyboard is at least this much of the height (px); a browser's own bar is less. */
export const KEYBOARD_MIN_PX = 120;

/** The visual viewport is much shorter than the page and not pinch-zoomed: a keyboard is up. */
export function keyboardUp(v: ViewportView): boolean {
	if (!v.visual || v.visual.scale > 1.01) return false;
	return v.innerHeight - v.visual.height >= KEYBOARD_MIN_PX;
}

const live = (): ViewportView => ({
	innerHeight: window.innerHeight,
	visual: window.visualViewport,
});

/** Whether a touch keyboard is up now. */
export const keyboardIsUp = (): boolean => typeof window !== 'undefined' && keyboardUp(live());

/** Whether an element takes text (so that a keyboard is up because of it). */
const editable = (el: Element | null): el is HTMLElement =>
	el instanceof HTMLElement &&
	(el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement);

/** The longest to wait for a keyboard to go (ms): iOS animates it away in about 300. */
export const KEYBOARD_WAIT_MS = 450;

/**
 * Lets the touch keyboard go before a sheet opens: nothing to do (it resolves at once) when no
 * keyboard is up, else it blurs the focused text field and waits for the viewport to grow back.
 */
export function settleKeyboard(view: () => ViewportView = live): Promise<void> {
	if (typeof window === 'undefined' || !keyboardUp(view())) return Promise.resolve();
	const focused = document.activeElement;
	if (editable(focused)) focused.blur();
	const vv = window.visualViewport;
	return new Promise((resolve) => {
		let done = false;
		const finish = (): void => {
			if (done) return;
			done = true;
			vv?.removeEventListener('resize', check);
			clearTimeout(timer);
			// One frame for the viewport's new size to reach layout before the sheet is placed.
			requestAnimationFrame(() => resolve());
		};
		const check = (): void => {
			if (!keyboardUp(view())) finish();
		};
		const timer = setTimeout(finish, KEYBOARD_WAIT_MS);
		vv?.addEventListener('resize', check);
	});
}

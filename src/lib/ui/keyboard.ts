// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The touch keyboard and the sheets that open over it. On a phone the on-screen keyboard shrinks the
 * visual viewport but not the layout viewport that a `position: fixed` sheet is placed in, so a
 * sheet opened while the keyboard is up (the docs button, pressed while the editor has the focus)
 * first appears above the keyboard, part way up the screen, and drops to the foot when the keyboard
 * goes. `whenKeyboardGone` lets the keyboard go first: it blurs the field that holds it and runs its
 * callback once the visual viewport is back to full height (or after a short wait), so that the
 * sheet opens, and slides in, at its final place. In the first load (Sheet.svelte), so it is small.
 */

/** What of the browser's viewports the rule reads; the test gives its own. */
export interface ViewportView {
	/** The layout viewport's height (`window.innerHeight`). */
	innerHeight: number;
	/** The visual viewport (`window.visualViewport`), if the browser has one. */
	visual: { height: number; scale: number } | null;
}

/** A keyboard is at least this much of the height (px); a browser's own bar is less. */
export const KEYBOARD_MIN_PX = 120;
/** The longest to wait for a keyboard to go (ms): iOS animates it away in about 300. */
export const KEYBOARD_WAIT_MS = 450;

/** The visual viewport is much shorter than the page and not pinch-zoomed: a keyboard is up. */
export const keyboardUp = (v: ViewportView): boolean =>
	v.visual !== null && v.visual.scale <= 1.01 && v.innerHeight - v.visual.height >= KEYBOARD_MIN_PX;

const liveViewport = (): ViewportView => ({
	innerHeight: window.innerHeight,
	visual: window.visualViewport,
});

/** Runs `then` now when no keyboard is up, else when it has gone (the focused element is blurred). */
export function whenKeyboardGone(then: () => void, view: () => ViewportView = liveViewport): void {
	if (!keyboardUp(view())) return then();
	(document.activeElement as HTMLElement | null)?.blur();
	const vv = window.visualViewport;
	const go = (): void => {
		vv?.removeEventListener('resize', check);
		clearTimeout(timer);
		then();
	};
	const check = (): void => {
		if (!keyboardUp(view())) go();
	};
	const timer = setTimeout(go, KEYBOARD_WAIT_MS);
	vv?.addEventListener('resize', check);
}

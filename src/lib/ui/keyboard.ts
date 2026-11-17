// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The touch keyboard and the sheets that open over it. On a phone the on-screen keyboard shrinks the
 * visual viewport but not the layout viewport that a `position: fixed` sheet is placed in, so a
 * sheet opened while the keyboard is up (the docs button, pressed while the editor has the focus)
 * first appears above the keyboard, part way up the screen, and drops to the foot when the keyboard
 * goes. `whenKeyboardGone` lets the keyboard go first: it blurs the field that holds it, remembers
 * it (`Focused`: the element and its selection), and runs its callback once the visual viewport is
 * back to full height (or after a short wait), so that the sheet opens, and slides in, at its final
 * place. When the sheet has gone `restoreFocus` gives the field its focus and selection back, which
 * raises the keyboard again, unless the focus has gone somewhere deliberate in the meantime. In the
 * first load (Sheet.svelte), so it is small.
 */

/** What of the browser's viewports the rule reads; the test gives its own. */
export interface ViewportView {
	/** The layout viewport's height (`window.innerHeight`). */
	innerHeight: number;
	/** The visual viewport (`window.visualViewport`), if the browser has one. */
	visual: { height: number; scale: number } | null;
}

/** A field that held the keyboard: the element, and its selection (a text box's offsets, or a rich text's range). */
export interface Focused {
	el: HTMLElement;
	start?: number | null;
	end?: number | null;
	direction?: 'forward' | 'backward' | 'none' | null;
	range?: Range;
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

/** The focused element with its selection, taken before it is blurred. */
export function rememberFocus(el: HTMLElement): Focused {
	const f: Focused = { el };
	if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
		try {
			f.start = el.selectionStart;
			f.end = el.selectionEnd;
			f.direction = el.selectionDirection;
		} catch {
			// Some input types (a date) have no selection.
		}
	} else {
		const s = getSelection();
		if (s?.rangeCount && el.contains(s.anchorNode)) f.range = s.getRangeAt(0).cloneRange();
	}
	return f;
}

/**
 * Gives a remembered field its focus and selection back, if it is still on the page and nothing
 * else has taken the focus on purpose since: the focus is on the page itself, as it is after a
 * dialog has closed over a blurred field, or still on something inside `leaving` (the dialog that
 * has just been closed, whose focused button the browser has not yet taken the focus from).
 */
export function restoreFocus(f: Focused | null, leaving?: Element | null): void {
	if (!f?.el.isConnected) return;
	const now = document.activeElement;
	if (now && now !== document.body && now !== document.documentElement && !leaving?.contains(now)) {
		return;
	}
	f.el.focus({ preventScroll: true });
	if (f.start != null && 'setSelectionRange' in f.el) {
		try {
			(f.el as HTMLInputElement).setSelectionRange(
				f.start,
				f.end ?? f.start,
				f.direction ?? undefined,
			);
		} catch {
			// The element changed type since.
		}
	} else if (f.range?.startContainer.isConnected) {
		const s = getSelection();
		s?.removeAllRanges();
		s?.addRange(f.range);
	}
}

/**
 * Runs `then` now when no keyboard is up, else when it has gone: the focused element is blurred
 * (and given to `then`, to be restored later). `then` is given null when nothing was blurred.
 */
export function whenKeyboardGone(
	then: (was: Focused | null) => void,
	view: () => ViewportView = liveViewport,
): void {
	if (!keyboardUp(view())) return then(null);
	const active = document.activeElement;
	const was = active instanceof HTMLElement ? rememberFocus(active) : null;
	(active as HTMLElement | null)?.blur();
	const vv = window.visualViewport;
	const go = (): void => {
		vv?.removeEventListener('resize', check);
		clearTimeout(timer);
		then(was);
	};
	const check = (): void => {
		if (!keyboardUp(view())) go();
	};
	const timer = setTimeout(go, KEYBOARD_WAIT_MS);
	vv?.addEventListener('resize', check);
}

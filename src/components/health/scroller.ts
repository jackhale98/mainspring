// SPDX-License-Identifier: GPL-2.0-or-later
// The element that scrolls the Health panel's content: the sheet's or the side panel's body.

/** The nearest ancestor of `el` that scrolls vertically, or null when the page itself does. */
export function scrollerOf(el: HTMLElement): HTMLElement | null {
	for (let p = el.parentElement; p; p = p.parentElement) {
		const o = getComputedStyle(p).overflowY;
		if (o === 'auto' || o === 'scroll') return p;
	}
	return null;
}

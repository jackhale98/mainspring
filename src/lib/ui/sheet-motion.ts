// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * How a sheet moves, in one place: the bottom sheets (Sheet.svelte) and the Calendar's day details
 * share these numbers and this curve. Everything here moves `transform` (and fades `opacity`), so
 * the browser runs it on the compositor and never lays the page out again while a sheet slides.
 * With "reduce motion" nothing slides: `reducedMotion()` is true and every duration is 0.
 */

/** The curve of an iOS sheet: quick to leave, a long soft landing. The CSS token has the same one. */
export const SHEET_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** A sheet slides in, or grows to another height, in this long (ms). */
export const SHEET_MS = 340;
/** A sheet leaves faster than it arrives (ms). */
export const SHEET_OUT_MS = 240;
/** The curve a leaving sheet follows: it speeds up as it goes. */
export const SHEET_OUT_EASING = 'cubic-bezier(0.4, 0, 1, 1)';

export const reducedMotion = (): boolean =>
	typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The y of a cubic Bezier through (0,0), (x1,y1), (x2,y2), (1,1) at the progress `x` (0 to 1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
	const at = (t: number, a: number, b: number): number =>
		3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
	const slope = (t: number, a: number, b: number): number =>
		3 * a * (1 - t) * (1 - t) + 6 * (b - a) * (1 - t) * t + 3 * (1 - b) * t * t;
	return (x) => {
		if (x <= 0 || x >= 1) return Math.max(0, Math.min(1, x));
		// Newton's method for the t whose x is `x` (a handful of steps suffice for these curves).
		let t = x;
		for (let i = 0; i < 8; i++) t -= (at(t, x1, x2) - x) / (slope(t, x1, x2) || 1);
		return at(Math.max(0, Math.min(1, t)), y1, y2);
	};
}

const arrive = cubicBezier(0.32, 0.72, 0, 1);
const leave = cubicBezier(0.4, 0, 1, 1);

/**
 * A Svelte transition for a panel that sits at the foot of its container: it slides up from the
 * bottom edge when it comes and back down when it goes (`in:` and `out:`), the way a bottom sheet
 * does. `enabled: false` (a wide layout where the panel is a column) plays nothing.
 */
export function slideUp(
	_node: Element,
	params: { enabled?: boolean } = {},
	options: { direction?: 'in' | 'out' | 'both' } = {},
): { duration: number; easing: (t: number) => number; css: (t: number, u: number) => string } {
	const off = params.enabled === false || reducedMotion();
	const out = options.direction === 'out';
	return {
		duration: off ? 0 : out ? SHEET_OUT_MS : SHEET_MS,
		easing: out ? leave : arrive,
		css: (_t, u) => `transform: translateY(${u * 100}%)`,
	};
}

/**
 * Slides an element that has just changed height from where its top edge was: its box is already
 * at the new height, so it starts displaced by the change and glides to rest. The bottom edge is
 * pinned, so only the top edge travels. `dy` is the new height minus the old one, in px.
 */
export function glideFrom(el: Element, dy: number): Animation | null {
	if (dy === 0 || reducedMotion() || typeof el.animate !== 'function') return null;
	return el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
		duration: SHEET_MS,
		easing: SHEET_EASING,
	});
}

/** The animations of a sheet leaving: the panel to the edge, and the backdrop fading out. */
export function slideAway(
	panel: Element,
	dialog: HTMLElement,
	side: 'bottom' | 'start',
): Animation[] {
	const r = panel.getBoundingClientRect();
	const to =
		side === 'bottom'
			? `translateY(${Math.max(0, window.innerHeight - r.top)}px)`
			: `translateX(${-Math.max(0, r.right)}px)`;
	const timing = { duration: SHEET_OUT_MS, easing: SHEET_OUT_EASING, fill: 'forwards' } as const;
	const out = [panel.animate([{ transform: 'none' }, { transform: to }], timing)];
	try {
		out.push(
			dialog.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, pseudoElement: '::backdrop' }),
		);
	} catch {
		// A browser without animatable ::backdrop: the panel alone slides.
	}
	return out;
}

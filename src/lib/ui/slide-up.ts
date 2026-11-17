// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Calendar's day details slide the way a bottom sheet does (Sheet.svelte): up from the foot of
 * their container, and back down, on transform only, with the same durations as the CSS tokens
 * `--sheet-ms` and `--sheet-out-ms` (tokens.css), and none with "reduce motion". Its own
 * module, so that only the Calendar chunk carries it, not the first load.
 */

/** A sheet slides in in this long (ms). */
export const SHEET_MS = 340;
/** A sheet leaves faster than it arrives (ms). */
export const SHEET_OUT_MS = 240;

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A Svelte transition for a panel that sits at the foot of its container: it slides up from the
 * bottom edge when it comes and back down when it goes (`in:` and `out:`). `enabled: false` (a
 * wide layout, where the panel is a column) plays nothing. Svelte writes the keyframes (a
 * `translateY` each) and the browser runs them; the easing here only shapes the steps.
 */
export function slideUp(
	_node: Element,
	params: { enabled?: boolean } = {},
	options: { direction?: 'in' | 'out' | 'both' } = {},
): { duration: number; easing: (t: number) => number; css: (t: number, u: number) => string } {
	const out = options.direction === 'out';
	return {
		duration: params.enabled === false || reducedMotion() ? 0 : out ? SHEET_OUT_MS : SHEET_MS,
		easing: out ? (t) => t * t : (t) => 1 - (1 - t) ** 4,
		css: (_t, u) => `transform: translateY(${u * 100}%)`,
	};
}

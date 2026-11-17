// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Calendar's day details slide the way a bottom sheet does (Sheet.svelte): up from the foot of
 * their container, and back down, on transform only, for as long as the CSS tokens `--sheet-ms`
 * and `--sheet-out-ms` say (tokens.css; both 0 with "reduce motion", so nothing slides). Its own
 * module, so that only the Calendar chunk carries it, not the first load.
 */

const tokenMs = (el: Element, token: string): number =>
	parseFloat(getComputedStyle(el).getPropertyValue(token)) || 0;

/**
 * A Svelte transition for a panel that sits at the foot of its container: it slides up from the
 * bottom edge when it comes and back down when it goes (`in:` and `out:`). `enabled: false` (a
 * wide layout, where the panel is a column) plays nothing. Svelte writes the keyframes (a
 * `translateY` each) and the browser runs them; the easing here only shapes the steps.
 */
export function slideUp(
	node: Element,
	params: { enabled?: boolean } = {},
	options: { direction?: 'in' | 'out' | 'both' } = {},
): { duration: number; easing: (t: number) => number; css: (t: number, u: number) => string } {
	const out = options.direction === 'out';
	return {
		duration: params.enabled === false ? 0 : tokenMs(node, out ? '--sheet-out-ms' : '--sheet-ms'),
		easing: out ? (t) => t * t : (t) => 1 - (1 - t) ** 4,
		css: (_t, u) => `transform: translateY(${u * 100}%)`,
	};
}

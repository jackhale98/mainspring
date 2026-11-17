// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which rows of a long list are mounted (phase-3.md 8.2: the health list is windowed beyond 200
 * findings; T18). Pure: heights in, a range and two spacer heights out. Rows have no fixed height (a
 * sentence wraps, a fix editor opens), so each row has the height it was last measured at, and an
 * unmeasured one the average of the measured ones (`ESTIMATE` before any is). The window is what the
 * scroller shows plus an overscan above and below, and always holds the `keep` rows (the one with
 * the focus and the few after it, so that Tab and Shift+Tab find a mounted row).
 */

/** What a row is taken to be before it is measured, in px. */
export const ESTIMATE = 120;
/** Rows mounted beyond the visible ones, each side. */
export const OVERSCAN = 6;
/** Rows kept after (and before) the one that has the focus. */
export const KEEP_AFTER = 6;
export const KEEP_BEFORE = 2;

export interface Windowed {
	/** First mounted row, and one past the last. */
	readonly start: number;
	readonly end: number;
	/** The height of the rows before and after the mounted ones, in px. */
	readonly before: number;
	readonly after: number;
}

/**
 * @param heights measured height per row, `undefined` when not measured yet
 * @param from top of the visible part, in px from the list's top
 * @param to bottom of the visible part, in px from the list's top
 * @param focus index of the row that holds the focus, or null
 */
export function windowOf(
	heights: ReadonlyArray<number | undefined>,
	from: number,
	to: number,
	focus: number | null = null,
): Windowed {
	const n = heights.length;
	if (n === 0) return { start: 0, end: 0, before: 0, after: 0 };
	let sum = 0;
	let known = 0;
	for (const h of heights) {
		if (h !== undefined) {
			sum += h;
			known++;
		}
	}
	const guess = known === 0 ? ESTIMATE : sum / known;
	const at = (i: number): number => heights[i] ?? guess;
	// The first row that ends below `from`, and the first that starts at or below `to`.
	let y = 0;
	let first = n;
	let last = n;
	for (let i = 0; i < n; i++) {
		const h = at(i);
		if (first === n && y + h > from) {
			first = i;
		}
		if (y >= to) {
			last = i;
			break;
		}
		y += h;
	}
	if (first === n) first = Math.max(0, n - 1);
	let start = Math.max(0, first - OVERSCAN);
	let end = Math.min(n, last + OVERSCAN);
	if (focus !== null && focus >= 0 && focus < n) {
		start = Math.min(start, Math.max(0, focus - KEEP_BEFORE));
		end = Math.max(end, Math.min(n, focus + KEEP_AFTER + 1));
	}
	let before = 0;
	for (let i = 0; i < start; i++) before += at(i);
	let after = 0;
	for (let i = end; i < n; i++) after += at(i);
	return { start, end, before, after };
}

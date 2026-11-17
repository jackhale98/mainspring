// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which month blocks of the vertical list are in the DOM (phase-3.md 8.2). Every block has the same
 * height (6 rows, grid.ts), so the blocks to mount follow from the scroll offset alone, with no
 * measuring of the others, and each is placed at `index * blockHeight`. A plan of three years is 36
 * blocks of 42 cells; only the ones in view and a margin of two either side are mounted, plus the
 * ones the caller must keep (the month with the keyboard focus, so the grid keeps its tab stop).
 */

/** Months in view: the first that shows and the last that shows. */
export function visibleMonths(
	top: number,
	height: number,
	monthH: number,
	count: number,
): readonly [first: number, last: number] {
	if (count <= 0 || !(monthH > 0)) return [0, -1];
	const first = Math.max(0, Math.min(count - 1, Math.floor(top / monthH)));
	const last = Math.max(
		first,
		Math.min(count - 1, Math.ceil((top + Math.max(0, height)) / monthH) - 1),
	);
	return [first, last];
}

/** The indices to mount, ascending and unique: the visible ones, `overscan` either side, and `keep`. */
export function monthWindow(
	top: number,
	height: number,
	monthH: number,
	count: number,
	overscan: number,
	keep: ReadonlyArray<number | null>,
): number[] {
	const [first, last] = visibleMonths(top, height, monthH, count);
	const out = new Set<number>();
	if (last >= first) {
		for (let i = Math.max(0, first - overscan); i <= Math.min(count - 1, last + overscan); i++) {
			out.add(i);
		}
	}
	for (const k of keep) if (k !== null && k >= 0 && k < count) out.add(k);
	return [...out].sort((a, b) => a - b);
}

/** The scroll offset that puts month `i` at the top of the list. */
export const offsetOfMonth = (i: number, monthH: number): number => Math.max(0, i * monthH);

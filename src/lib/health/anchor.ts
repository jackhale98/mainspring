// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What keeps the health list still while it is measured (phase-3.md 8.2; T18, the WebKit jump).
 * The list is windowed (window.ts): rows far from the scroller are spacers of an estimated height, and
 * each row that is mounted replaces its share of an estimate with its real height. When that happens
 * above what the scroller shows, everything shown moves, and a browser with scroll anchoring (Chromium)
 * scrolls by the same amount to hide it. WebKit has none, so the list does it itself: before the
 * window changes it notes the rows in view (`pickAnchor`), and after the change it scrolls by how
 * far the first of them that is still there moved (`anchorShift`). All positions are in px from the
 * list's own top, so groups above and below that change in the same flush do not disturb each other.
 *
 * Writing `scrollTop` while a finger or a fling is scrolling stops the fling on iOS, so then the
 * list holds the row with a bias in its spacer instead (`nextBias`, `spacerOf`) and puts the bias
 * into `scrollTop` in one step when the scrolling stops (`releaseShift`).
 *
 * Also here: the bookkeeping of measured heights (`remember`): a row's height is kept by its key for
 * good, so a group's height depends only on which rows have been measured, and each row is measured
 * at most once until it really changes. Heights are fractional (13 px text at a 1.5 line height is
 * 19.5 px a line), so they are measured as they are, never rounded.
 */

/** A mounted row's place in the list, px from the list's top. */
export interface RowBox {
	readonly key: string;
	readonly top: number;
	readonly bottom: number;
}

/**
 * What to hold still: the rows that reach the view (the first that is still mounted after the
 * change is the one held), or (a list wholly above the scroller's top) the list's height.
 */
export type Anchor =
	| {
			readonly kind: 'rows';
			readonly rows: ReadonlyArray<{ readonly key: string; readonly top: number }>;
	  }
	| { readonly kind: 'end'; readonly height: number };

/**
 * The anchor for a list whose visible part is `from` to `to` px from the list's top (`from` negative
 * when the list starts below the top of the scroller). Null when nothing above the visible part
 * needs holding: the list starts at or below the scroller's top, or no mounted row reaches the view.
 */
export function pickAnchor(
	rows: readonly RowBox[],
	listHeight: number,
	from: number,
	to: number,
): Anchor | null {
	if (from <= 0) return null;
	if (from >= listHeight) return { kind: 'end', height: listHeight };
	const seen = rows
		.filter((r) => r.bottom > from && r.top < to)
		.map((r) => ({ key: r.key, top: r.top }));
	return seen.length > 0 ? { kind: 'rows', rows: seen } : null;
}

/**
 * How far to scroll (px, positive: down) so the anchor is where it was, given the rows and the
 * height as they are now. 0 when none of the anchor's rows is mounted any more. `owed` is how far a
 * render that has not happened yet will still move it (a bias that was just changed).
 */
export function anchorShift(
	anchor: Anchor | null,
	rows: readonly RowBox[],
	listHeight: number,
	owed = 0,
): number {
	if (anchor === null) return 0;
	if (anchor.kind === 'end') return listHeight - (anchor.height + owed);
	for (const was of anchor.rows) {
		const row = rows.find((r) => r.key === was.key);
		if (row) return row.top - (was.top + owed);
	}
	return 0;
}

/** A mounted row that changed height (an editor opened, the panel was resized). */
export interface RowResize {
	/** Its top now, px in the scroller's frame. */
	readonly top: number;
	/** Its height before and now, without the gap below it. */
	readonly was: number;
	readonly now: number;
}

/**
 * How far to scroll so what the scroller shows stays when several mounted rows changed height at
 * once. Only a row that ended at or above the top of the scroller before the change moves it. A row's
 * top before the change is its top now less what the changes above it added.
 * @param viewTop the scroller's top, same frame
 */
export function resizeShift(changes: readonly RowResize[], viewTop: number): number {
	let above = 0;
	let shift = 0;
	for (const c of [...changes].sort((a, b) => a.top - b.top)) {
		const delta = c.now - c.was;
		if (c.top - above + c.was <= viewTop) shift += delta;
		above += delta;
	}
	return shift;
}

/** The before-spacer's height: the estimate of the rows before the window, plus the bias, not below 0. */
export const spacerOf = (before: number, bias: number): number => Math.max(0, before + bias);

/**
 * The bias that holds the anchor when it moved by `shift` (positive: down) and the list may not
 * write `scrollTop`: a smaller spacer moves it up. `owed` is how far the render of that bias will
 * move the anchor, which the next `anchorShift` has to take into account.
 */
export function nextBias(
	bias: number,
	shift: number,
	before: number,
): { readonly bias: number; readonly owed: number } {
	const next = Math.max(-before, bias - shift);
	return { bias: next, owed: spacerOf(before, next) - spacerOf(before, bias) };
}

/** A height differs from what was remembered by less than this, in px: layout noise, not a change. */
export const MEASURE_EPSILON = 0.1;

/**
 * The remembered heights with `updates` applied: the same map when none differs by `MEASURE_EPSILON`
 * or more (so nothing downstream runs again), else a new map. Heights are never forgotten when a row
 * unmounts, so a row scrolled away and back keeps its height.
 */
export function remember(
	known: ReadonlyMap<string, number>,
	updates: Iterable<readonly [string, number]>,
): ReadonlyMap<string, number> {
	let next: Map<string, number> | null = null;
	for (const [key, h] of updates) {
		const was = (next ?? known).get(key);
		if (was !== undefined && Math.abs(was - h) < MEASURE_EPSILON) continue;
		next ??= new Map(known);
		next.set(key, h);
	}
	return next ?? known;
}

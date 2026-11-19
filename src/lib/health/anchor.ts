// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What keeps the health list still while it is measured (phase-3.md 8.2; T18, the WebKit jump).
 * The list is windowed (window.ts): rows far from the scroller are spacers of an estimated height, and
 * each row that is mounted replaces its share of an estimate with its real height. When that happens
 * above what the scroller shows, everything shown moves, and a browser with scroll anchoring (Chromium)
 * scrolls by the same amount to hide it. WebKit has none, so the list does it itself: before the
 * window changes it notes the first row in view (`pickAnchor`), and after the change it scrolls by how
 * far that row moved (`anchorShift`). All positions are in px from the list's own top, so groups above
 * and below that change in the same flush do not disturb each other.
 *
 * Also here: the bookkeeping of measured heights (`remember`): a row's height is kept by its key for
 * good, so a group's height depends only on which rows have been measured, and each row is measured
 * at most once until it really changes.
 */

/** A mounted row's place in the list, px from the list's top. */
export interface RowBox {
	readonly key: string;
	readonly top: number;
	readonly bottom: number;
}

/** What to hold still: a row's top, or (a list wholly above the scroller's top) the list's height. */
export type Anchor =
	| { readonly kind: 'row'; readonly key: string; readonly top: number }
	| { readonly kind: 'end'; readonly height: number };

/**
 * The anchor for a list whose visible part starts `from` px below the list's top (negative when the
 * list starts below the top of the scroller). Null when nothing above the visible part needs holding:
 * the list starts at or below the scroller's top, or no mounted row reaches it.
 */
export function pickAnchor(
	rows: readonly RowBox[],
	listHeight: number,
	from: number,
): Anchor | null {
	if (from <= 0) return null;
	if (from >= listHeight) return { kind: 'end', height: listHeight };
	const row = rows.find((r) => r.bottom > from);
	return row ? { kind: 'row', key: row.key, top: row.top } : null;
}

/**
 * How far to scroll (px, positive: down) so the anchor is where it was, given the rows and the
 * height as they are now. 0 when the anchor's row is not mounted any more.
 */
export function anchorShift(
	anchor: Anchor | null,
	rows: readonly RowBox[],
	listHeight: number,
): number {
	if (anchor === null) return 0;
	if (anchor.kind === 'end') return listHeight - anchor.height;
	const row = rows.find((r) => r.key === anchor.key);
	return row ? row.top - anchor.top : 0;
}

/**
 * A mounted row changed height (an editor opened, the panel was resized): how far to scroll so what
 * the scroller shows stays. Only a row that ended at or above the top of the scroller moves it.
 * @param bottomBefore the row's bottom before the change, px in the scroller's frame
 * @param viewTop the scroller's top, same frame
 */
export function resizeShift(bottomBefore: number, viewTop: number, delta: number): number {
	return bottomBefore <= viewTop ? delta : 0;
}

/** A height differs from what was remembered by less than this, in px: sub-pixel noise, not a change. */
export const MEASURE_EPSILON = 0.5;

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

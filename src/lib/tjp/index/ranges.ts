// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Fast lookup of the text-only range that blocks an edit target, with the semantics of
 * `findTextOnly` (text-only.ts): ranges sorted by start, plus the running maximum of their ends,
 * so a query visits only ranges that can overlap the target.
 */
import { TEXT_ONLY_PRIORITY, blocks, type TextOnly } from '../text-only';

export interface RangeIndex {
	readonly list: readonly TextOnly[];
	/** maxTo[i] = max end of list[0..i]. */
	readonly maxTo: readonly number[];
}

const rank = (t: TextOnly): number => TEXT_ONLY_PRIORITY.indexOf(t.reason);

export function rangeIndex(ranges: readonly TextOnly[]): RangeIndex {
	const list = [...ranges].sort((a, b) => a.at.from - b.at.from || b.at.to - a.at.to);
	const maxTo: number[] = [];
	let m = -1;
	for (const r of list) {
		m = Math.max(m, r.at.to);
		maxTo.push(m);
	}
	return { list, maxTo };
}

/** The highest-priority range of `idx` that blocks an edit of [from, to), or null. */
export function blockingIn(idx: RangeIndex, from: number, to: number): TextOnly | null {
	const { list, maxTo } = idx;
	// Ranges starting at or after `to` cannot block (for an insertion point, at or after `from`).
	const limit = from === to ? from : to;
	let lo = 0;
	let hi = list.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((list[mid]?.at.from ?? 0) < limit) lo = mid + 1;
		else hi = mid;
	}
	let best: TextOnly | null = null;
	for (let i = lo - 1; i >= 0 && (maxTo[i] ?? -1) > from; i--) {
		const r = list[i];
		if (!r || !blocks(r, from, to)) continue;
		if (!best || rank(r) < rank(best)) best = r;
	}
	return best;
}

/** The more important of two reasons (TEXT_ONLY_PRIORITY), keeping `a` on a tie. */
export function stronger(a: TextOnly | null, b: TextOnly | null): TextOnly | null {
	if (!a) return b;
	if (!b) return a;
	return rank(b) < rank(a) ? b : a;
}

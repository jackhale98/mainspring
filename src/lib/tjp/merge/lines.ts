// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Three-way merge on lines (phase-4.md 6.4 rule 1) with `node-diff3`'s two-way diff.
 *
 * - Lines split on '\n' only, each line keeping its '\n' (the last may lack one), so '\r', a BOM
 *   and replacement characters are ordinary characters of their line and pass through untouched
 *   (document.ts, ADR-0002 #13, ADR-0003 #1).
 * - `diff3Regions` partitions the three line lists into regions, each with its range on every
 *   side. It combines the hunks of `diffIndices(o, a)` and `diffIndices(o, b)` as
 *   `diff3MergeRegions` does (hunks that overlap or touch in `o` form one region), but keeps every
 *   side's range, which `diff3MergeRegions` drops for one-sided regions, so callers can map a
 *   region back to each text.
 * - The two diffs are made together (`split3`): large chunks are split at lines that occur once
 *   in each of the three lists (patience diff's anchors), so `diffIndices` only sees small chunks
 *   (Hunt-McIlroy's cost grows with repeated lines such as `}`, which a plan has thousands of;
 *   12.2), and both diffs see the same chunks, so an edit both sides made alike is merged once.
 * - A `conflict` region whose two sides are equal (a false conflict) is reported as such; the
 *   caller decides (equal lines merge cleanly; equal keys need not mean equal statements).
 */
import { diffIndices } from 'node-diff3';

/** The lines of `text`, each with its '\n'. `splitLines(t).join('') === t`. */
export function splitLines(text: string): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < text.length) {
		const j = text.indexOf('\n', i);
		if (j < 0) {
			out.push(text.slice(i));
			break;
		}
		out.push(text.slice(i, j + 1));
		i = j + 1;
	}
	return out;
}

/** Offsets of each line's start, plus the total length at the end (`starts.length = n + 1`). */
export function lineStarts(lines: readonly string[]): number[] {
	const out = [0];
	let at = 0;
	for (const l of lines) {
		at += l.length;
		out.push(at);
	}
	return out;
}

export type RegionKind = 'same' | 'ours' | 'theirs' | 'conflict';

/** A half-open range of line (or item) indices. */
export type IxRange = readonly [number, number];

export interface Region {
	/** `same`: equal on all sides; `ours`/`theirs`: only that side changed; `conflict`: both. */
	readonly kind: RegionKind;
	readonly o: IxRange;
	readonly a: IxRange;
	readonly b: IxRange;
}

interface Hunk {
	readonly a: boolean;
	readonly oS: number;
	readonly oE: number;
	readonly xS: number;
	readonly xE: number;
}

/** Chunks at most this many cells (lines of the base times the longer side's) go to diffIndices. */
const SMALL = 4096;

/** The longest increasing run of `ys` (patience sorting), as indices into `ys`. */
function increasing(ys: readonly number[]): number[] {
	const tails: number[] = [];
	const prev: number[] = new Array<number>(ys.length).fill(-1);
	for (let i = 0; i < ys.length; i++) {
		const y = ys[i] as number;
		let lo = 0;
		let hi = tails.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((ys[tails[mid] as number] as number) < y) lo = mid + 1;
			else hi = mid;
		}
		if (lo > 0) prev[i] = tails[lo - 1] as number;
		tails[lo] = i;
	}
	const out: number[] = [];
	for (
		let k = tails.length > 0 ? (tails[tails.length - 1] as number) : -1;
		k >= 0;
		k = prev[k] as number
	) {
		out.push(k);
	}
	return out.reverse();
}

/** A chunk of the three line lists: [o0, o1), [a0, a1), [b0, b1). */
type Chunk = [number, number, number, number, number, number];

/** The two-way hunks of a chunk without anchors: `diffIndices` on it whole, or one hunk. */
function pairwise(
	o: readonly string[],
	x: readonly string[],
	c: [number, number, number, number],
	isA: boolean,
	out: Hunk[],
): void {
	const [oS, oE, xS, xE] = c;
	if (oS === oE && xS === xE) return;
	if (oS === oE || xS === xE) {
		out.push({ a: isA, oS, oE, xS, xE });
		return;
	}
	for (const h of diffIndices(o.slice(oS, oE), x.slice(xS, xE))) {
		out.push({
			a: isA,
			oS: oS + h.buffer1[0],
			oE: oS + h.buffer1[0] + h.buffer1[1],
			xS: xS + h.buffer2[0],
			xE: xS + h.buffer2[0] + h.buffer2[1],
		});
	}
}

/**
 * The hunks of `a` and `b` against `o` in one chunk, appended to `ha` and `hb`. A large chunk is
 * split at the lines that occur once in each of the three lists, in the same order in all
 * (patience diff's anchors, made three-way), and each piece is diffed whole by `diffIndices`,
 * both ways, as `diff3Merge` would diff it: both two-way diffs see the same pieces, so an edit
 * the two sides made alike lands on the same base lines and is merged once. Ends are not cut
 * two-way, nor three-way: a cut decides alone where an edit among repeated lines goes (two-way
 * it applied a shared edit twice; three-way it moved edits next to each other, a conflict that
 * `diff3Merge` does not have).
 */
function split3(
	o: readonly string[],
	a: readonly string[],
	b: readonly string[],
	c: Chunk,
	ha: Hunk[],
	hb: Hunk[],
	limit: number,
): void {
	const [oS, oE, aS, aE, bS, bE] = c;
	const small = (oE - oS) * Math.max(aE - aS, bE - bS) <= limit;
	const anchors = small ? [] : anchorsOf(o, a, b, [oS, oE, aS, aE, bS, bE]);
	if (anchors.length === 0) {
		pairwise(o, a, [oS, oE, aS, aE], true, ha);
		pairwise(o, b, [oS, oE, bS, bE], false, hb);
		return;
	}
	let p: [number, number, number] = [oS, aS, bS];
	for (const [i, j, k] of anchors) {
		split3(o, a, b, [p[0], i, p[1], j, p[2], k], ha, hb, limit);
		p = [i + 1, j + 1, k + 1];
	}
	split3(o, a, b, [p[0], oE, p[1], aE, p[2], bE], ha, hb, limit);
}

/** Lines once in each list's chunk, as (o, a, b) indices increasing in all three. */
function anchorsOf(
	o: readonly string[],
	a: readonly string[],
	b: readonly string[],
	c: Chunk,
): Array<[number, number, number]> {
	const seen = new Map<string, [number, number, number, number, number, number]>();
	const count = (
		xs: readonly string[],
		from: number,
		to: number,
		side: 0 | 1 | 2,
		add: boolean,
	): void => {
		for (let i = from; i < to; i++) {
			const l = xs[i] as string;
			let e = seen.get(l);
			if (!e) {
				if (!add) continue;
				e = [0, -1, 0, -1, 0, -1];
				seen.set(l, e);
			}
			e[side * 2] = (e[side * 2] as number) + 1;
			e[side * 2 + 1] = i;
		}
	};
	count(o, c[0], c[1], 0, true);
	count(a, c[2], c[3], 1, false);
	count(b, c[4], c[5], 2, false);
	const triples: Array<[number, number, number]> = [];
	for (const e of seen.values())
		if (e[0] === 1 && e[2] === 1 && e[4] === 1) triples.push([e[1], e[3], e[5]]);
	triples.sort((x, y) => x[0] - y[0]);
	const byA = increasing(triples.map((t) => t[1])).map(
		(k) => triples[k] as [number, number, number],
	);
	return increasing(byA.map((t) => t[2])).map((k) => byA[k] as [number, number, number]);
}

function hunks3(
	o: readonly string[],
	a: readonly string[],
	b: readonly string[],
	limit: number,
): Hunk[] {
	const ha: Hunk[] = [];
	const hb: Hunk[] = [];
	split3(o, a, b, [0, o.length, 0, a.length, 0, b.length], ha, hb, limit);
	return [...ha, ...hb].sort((x, y) => x.oS - y.oS);
}

/** The range one side covers in a region, from its hunks there, or `o` shifted by its offset. */
function sideRange(hs: readonly Hunk[], rs: number, re: number, delta: number): IxRange {
	if (hs.length === 0) return [rs + delta, re + delta];
	let xS = Infinity;
	let xE = -Infinity;
	let oS = Infinity;
	let oE = -Infinity;
	for (const h of hs) {
		xS = Math.min(xS, h.xS);
		xE = Math.max(xE, h.xE);
		oS = Math.min(oS, h.oS);
		oE = Math.max(oE, h.oE);
	}
	return [xS + (rs - oS), xE + (re - oE)];
}

/** The regions of a three-way merge of `a` and `b` from `o` (module comment). */
export function diff3Regions(
	o: readonly string[],
	a: readonly string[],
	b: readonly string[],
	/** Chunks up to this many cells are diffed whole (tests lower it to exercise the anchors). */
	limit = SMALL,
): Region[] {
	const all = hunks3(o, a, b, limit);
	const out: Region[] = [];
	let cur = 0;
	let da = 0;
	let db = 0;
	const same = (to: number): void => {
		if (to > cur)
			out.push({ kind: 'same', o: [cur, to], a: [cur + da, to + da], b: [cur + db, to + db] });
	};
	for (let i = 0; i < all.length;) {
		const first = all[i] as Hunk;
		const rs = first.oS;
		let re = first.oE;
		let j = i + 1;
		while (j < all.length && (all[j] as Hunk).oS <= re) {
			re = Math.max(re, (all[j] as Hunk).oE);
			j++;
		}
		const group = all.slice(i, j);
		const ha = group.filter((h) => h.a);
		const hb = group.filter((h) => !h.a);
		same(rs);
		const ar = sideRange(ha, rs, re, da);
		const br = sideRange(hb, rs, re, db);
		const kind: RegionKind = hb.length === 0 ? 'ours' : ha.length === 0 ? 'theirs' : 'conflict';
		out.push({ kind, o: [rs, re], a: ar, b: br });
		cur = re;
		da = ar[1] - re;
		db = br[1] - re;
		i = j;
	}
	same(o.length);
	return out;
}

/** Whether `x[xr]` and `y[yr]` hold the same items. */
export function sameRange(
	x: readonly string[],
	xr: IxRange,
	y: readonly string[],
	yr: IxRange,
): boolean {
	if (xr[1] - xr[0] !== yr[1] - yr[0]) return false;
	for (let i = 0; i < xr[1] - xr[0]; i++) if (x[xr[0] + i] !== y[yr[0] + i]) return false;
	return true;
}

/** A conflict region whose sides differ (not a false conflict). */
export function trueConflict(r: Region, a: readonly string[], b: readonly string[]): boolean {
	return r.kind === 'conflict' && !sameRange(a, r.a, b, r.b);
}

/** The three-way merge of three strings as wholes, or null when both sides changed differently. */
export function merge3(o: string, a: string, b: string): string | null {
	if (a === b || b === o) return a;
	if (a === o) return b;
	return null;
}

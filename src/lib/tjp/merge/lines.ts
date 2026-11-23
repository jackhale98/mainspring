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
 * - The two-way diffs cut common ends and split large chunks at patience-diff anchors (lines
 *   that occur once on each side), so `diffIndices` only sees small chunks: Hunt-McIlroy's cost
 *   grows with repeated lines such as `}`, which a plan has thousands of (12.2 budget).
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

/** Chunks at most this many cells (lines of one side times the other's) go to diffIndices whole. */
const SMALL = 4096;

/**
 * The longest increasing run of `ys` over pairs sorted by x (patience sorting), as pair indices.
 */
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

/**
 * The two-way diff of `o[oS, oE)` and `x[xS, xE)` as hunks, appended to `out`. Common ends are
 * cut; a large chunk is split at the lines that occur once on each side and in the same order
 * (patience diff's anchors), so `diffIndices` (Hunt-McIlroy, whose cost grows with repeated
 * lines) only ever sees the small chunks between anchors.
 */
function diff2(
	o: readonly string[],
	x: readonly string[],
	oS: number,
	oE: number,
	xS: number,
	xE: number,
	isA: boolean,
	out: Hunk[],
): void {
	while (oS < oE && xS < xE && o[oS] === x[xS]) {
		oS++;
		xS++;
	}
	while (oE > oS && xE > xS && o[oE - 1] === x[xE - 1]) {
		oE--;
		xE--;
	}
	if (oS === oE && xS === xE) return;
	if (oS === oE || xS === xE || (oE - oS) * (xE - xS) <= SMALL) {
		if (oS === oE || xS === xE) {
			out.push({ a: isA, oS, oE, xS, xE });
			return;
		}
		diff2Small(o, x, oS, oE, xS, xE, isA, out);
		return;
	}
	const seen = new Map<string, { o: number; oi: number; x: number; xi: number }>();
	for (let i = oS; i < oE; i++) {
		const l = o[i] as string;
		const e = seen.get(l);
		if (e) e.o++;
		else seen.set(l, { o: 1, oi: i, x: 0, xi: -1 });
	}
	for (let j = xS; j < xE; j++) {
		const e = seen.get(x[j] as string);
		if (e) {
			e.x++;
			e.xi = j;
		}
	}
	const pairs: Array<[number, number]> = [];
	for (const e of seen.values()) if (e.o === 1 && e.x === 1) pairs.push([e.oi, e.xi]);
	pairs.sort((p, q) => p[0] - q[0]);
	const run = increasing(pairs.map((p) => p[1]));
	if (run.length === 0) {
		diff2Small(o, x, oS, oE, xS, xE, isA, out);
		return;
	}
	let po = oS;
	let px = xS;
	for (const k of run) {
		const [ai, aj] = pairs[k] as [number, number];
		diff2(o, x, po, ai, px, aj, isA, out);
		po = ai + 1;
		px = aj + 1;
	}
	diff2(o, x, po, oE, px, xE, isA, out);
}

/** A chunk without anchors: `diffIndices` on it whole. */
function diff2Small(
	o: readonly string[],
	x: readonly string[],
	oS: number,
	oE: number,
	xS: number,
	xE: number,
	isA: boolean,
	out: Hunk[],
): void {
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

function hunks(o: readonly string[], x: readonly string[], isA: boolean): Hunk[] {
	const out: Hunk[] = [];
	diff2(o, x, 0, o.length, 0, x.length, isA, out);
	return out;
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
): Region[] {
	const all = [...hunks(o, a, true), ...hunks(o, b, false)].sort((x, y) => x.oS - y.oS);
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

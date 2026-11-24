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
import { large, pairwise, SMALL, type Hunk } from './hunks';

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

/** Runs a step generator to its end (types.ts rule 5: the synchronous forms drive the steps). */
export function drive<T>(steps: Generator<void, T, void>): T {
	for (;;) {
		const r = steps.next();
		if (r.done) return r.value;
	}
}

/** Lines over which a chunk's work is followed by a pause (types.ts rule 5). */
const STEP_CELLS = 200_000;

/** Lines counted or diffed between two pauses among the pieces of a chunk (types.ts rule 5). */
const STEP_LINES = 3000;

/** The work done since the last pause, in lines. */
interface Work {
	lines: number;
}

/**
 * The hunks of `a` and `b` against `o` in one chunk, appended to `ha` and `hb`. A large chunk is
 * split at the lines that occur once in each of the three lists, in the same order in all
 * (patience diff's anchors, made three-way), and each piece is diffed whole by `diffIndices`,
 * both ways, as `diff3Merge` would diff it: both two-way diffs see the same pieces, so an edit
 * the two sides made alike lands on the same base lines and is merged once. A large piece with
 * no anchor (thousands of equal lines) is first cut at both ends by the lines equal in all three
 * lists, the same cut for both diffs (review N5); what is still large is cut per diff and diffed
 * by `myers`. A per-diff cut decides alone where an edit among equal lines goes, which applied a
 * shared edit twice before (M1): when the two diffs hold an equal edit at different base lines,
 * the chunk is one conflict instead. Small pieces are not cut: `diffIndices` alone decides, as
 * in `diff3Merge`.
 * Pauses (yields) after large pieces, and between pieces every STEP_LINES lines of work.
 */
function* split3(
	o: readonly string[],
	a: readonly string[],
	b: readonly string[],
	c: Chunk,
	ha: Hunk[],
	hb: Hunk[],
	limit: number,
	work: Work = { lines: 0 },
): Generator<void, void, void> {
	let [oS, oE, aS, aE, bS, bE] = c;
	const cells = (oE - oS) * Math.max(aE - aS, bE - bS);
	const anchors = cells <= limit ? [] : anchorsOf(o, a, b, [oS, oE, aS, aE, bS, bE]);
	work.lines += oE - oS + (aE - aS) + (bE - bS);
	if (anchors.length === 0 && cells <= SMALL) {
		pairwise(o, a, [oS, oE, aS, aE], true, ha);
		pairwise(o, b, [oS, oE, bS, bE], false, hb);
		return;
	}
	if (anchors.length > 0) {
		if (oE - oS > STEP_CELLS / 100) yield;
		let p: [number, number, number] = [oS, aS, bS];
		const piece = function* (q: Chunk): Generator<void, void, void> {
			yield* split3(o, a, b, q, ha, hb, limit, work);
			if (work.lines >= STEP_LINES) {
				work.lines = 0;
				yield;
			}
		};
		for (const [i, j, k] of anchors) {
			yield* piece([p[0], i, p[1], j, p[2], k]);
			p = [i + 1, j + 1, k + 1];
		}
		yield* piece([p[0], oE, p[1], aE, p[2], bE]);
		return;
	}
	while (oS < oE && aS < aE && bS < bE && o[oS] === a[aS] && o[oS] === b[bS]) {
		oS++;
		aS++;
		bS++;
	}
	while (oE > oS && aE > aS && bE > bS && o[oE - 1] === a[aE - 1] && o[oE - 1] === b[bE - 1]) {
		oE--;
		aE--;
		bE--;
	}
	if ((oE - oS) * Math.max(aE - aS, bE - bS) <= SMALL) {
		pairwise(o, a, [oS, oE, aS, aE], true, ha);
		pairwise(o, b, [oS, oE, bS, bE], false, hb);
		yield;
		return;
	}
	const ta = large(o, a, [oS, oE, aS, aE], true);
	const tb = large(o, b, [oS, oE, bS, bE], false);
	// Each diff placed its edits among equal lines on its own: an edit the two made alike may sit
	// at different base lines and be applied twice. Then the chunk is one conflict, never that.
	const same = (x: Hunk, y: Hunk): boolean =>
		x.oE - x.oS === y.oE - y.oS && sameRange(a, [x.xS, x.xE], b, [y.xS, y.xE]) && x.oS !== y.oS;
	if (ta.some((x) => tb.some((y) => same(x, y)))) {
		ha.push({ a: true, oS, oE, xS: aS, xE: aE });
		hb.push({ a: false, oS, oE, xS: bS, xE: bE });
	} else {
		ha.push(...ta);
		hb.push(...tb);
	}
	yield;
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

function* hunks3(
	o: readonly string[],
	a: readonly string[],
	b: readonly string[],
	limit: number,
): Generator<void, Hunk[], void> {
	const ha: Hunk[] = [];
	const hb: Hunk[] = [];
	yield* split3(o, a, b, [0, o.length, 0, a.length, 0, b.length], ha, hb, limit);
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
	return drive(diff3RegionsSteps(o, a, b, limit));
}

/** `diff3Regions` in steps: it pauses after the work on each large chunk (types.ts rule 5). */
export function* diff3RegionsSteps(
	o: readonly string[],
	a: readonly string[],
	b: readonly string[],
	limit = SMALL,
): Generator<void, Region[], void> {
	const all = yield* hunks3(o, a, b, limit);
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

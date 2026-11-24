// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Two-way hunks of one chunk for the line merge (lines.ts `split3`): `diffIndices` (node-diff3,
 * Hunt-McIlroy) on small chunks, and Myers' O(ND) diff on large chunks without anchors, whose cost
 * grows with the differences instead of the repeated lines (review N5).
 */
import { diffIndices } from 'node-diff3';

export interface Hunk {
	readonly a: boolean;
	readonly oS: number;
	readonly oE: number;
	readonly xS: number;
	readonly xE: number;
}

/** Chunks at most this many cells (lines of the base times the longer side's) go to diffIndices. */
export const SMALL = 4096;

/** The two-way hunks of a chunk without anchors: `diffIndices` on it whole, or one hunk. */
export function pairwise(
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

/** Differences beyond which `myers` gives up and reports the chunk as one hunk. */
const MAX_D = 1500;

/**
 * The two-way hunks of `o[oS, oE)` and `x[xS, xE)` by Myers' O(ND) diff, for a large chunk with
 * no anchor, where Hunt-McIlroy's cost explodes on repeated lines (review N5). More than MAX_D
 * differences: the whole chunk is one hunk (a coarser merge, never a wrong one).
 */
function myers(
	o: readonly string[],
	x: readonly string[],
	c: [number, number, number, number],
	isA: boolean,
	out: Hunk[],
): void {
	const [oS, oE, xS, xE] = c;
	const n = oE - oS;
	const m = xE - xS;
	const max = Math.min(n + m, MAX_D);
	const trace: Int32Array[] = [];
	let v = new Int32Array(3).fill(0);
	let found = -1;
	for (let d = 0; d <= max && found < 0; d++) {
		const next = new Int32Array(2 * d + 3);
		const get = (k: number): number => (k >= -d + 1 && k <= d - 1 ? (v[k + d] as number) : -1);
		for (let k = -d; k <= d; k += 2) {
			let i: number;
			if (k === -d || (k !== d && get(k - 1) < get(k + 1))) i = Math.max(get(k + 1), 0);
			else i = get(k - 1) + 1;
			let j = i - k;
			while (i < n && j < m && o[oS + i] === x[xS + j]) {
				i++;
				j++;
			}
			next[k + d + 1] = i;
			if (i >= n && j >= m) {
				found = d;
				break;
			}
		}
		trace.push(next);
		v = next;
	}
	if (found < 0) {
		out.push({ a: isA, oS, oE, xS, xE });
		return;
	}
	// Walk back through the trace, collecting the matched diagonals as hunks between them.
	const hunks: Hunk[] = [];
	let i = n;
	let j = m;
	for (let d = found; d > 0; d--) {
		const prev = trace[d - 1] as Int32Array;
		const at = (k: number): number =>
			k >= -(d - 1) && k <= d - 1 ? (prev[k + (d - 1) + 1] as number) : -1;
		const k = i - j;
		const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
		const pk = down ? k + 1 : k - 1;
		const pi = Math.max(at(pk), 0);
		const pj = pi - pk;
		const si = down ? pi : pi + 1;
		const sj = si - k;
		while (i > si && j > sj) {
			i--;
			j--;
		}
		// The step from (pi, pj) to (si, sj) is one line deleted (right) or inserted (down).
		const last = hunks[hunks.length - 1];
		if (last && last.oS === oS + si && last.xS === xS + sj) {
			hunks[hunks.length - 1] = { a: isA, oS: oS + pi, oE: last.oE, xS: xS + pj, xE: last.xE };
		} else hunks.push({ a: isA, oS: oS + pi, oE: oS + si, xS: xS + pj, xE: xS + sj });
		i = pi;
		j = pj;
	}
	out.push(...hunks.reverse());
}

/** The hunks of a large chunk of one diff: its own ends cut, then `myers` on the rest. */
export function large(
	o: readonly string[],
	x: readonly string[],
	c: [number, number, number, number],
	isA: boolean,
): Hunk[] {
	let [oS, oE, xS, xE] = c;
	while (oS < oE && xS < xE && o[oS] === x[xS]) {
		oS++;
		xS++;
	}
	while (oE > oS && xE > xS && o[oE - 1] === x[xE - 1]) {
		oE--;
		xE--;
	}
	const out: Hunk[] = [];
	if ((oE - oS) * (xE - xS) <= SMALL) pairwise(o, x, [oS, oE, xS, xE], isA, out);
	else myers(o, x, [oS, oE, xS, xE], isA, out);
	return out;
}

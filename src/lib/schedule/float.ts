// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Total float (phase-2.md 6.2): a CPM backward pass over the engine's dates and resolved
 * dependencies, in working minutes. Display data only (ADR-0007): never sent to the engine, never
 * a task's start or end.
 *
 * Why it is an estimate. TaskJuggler does not schedule by CPM. It levels resources as it goes: a
 * task waits for its people, its limits, their leaves and its `start`, `end`, `maxend` and similar
 * constraints, and an effort task's start moves to its first booked slot. This pass ignores all
 * of that. It asks only how far each task could slip, in working time, before a dependency chain
 * would push the finish (the latest end in the scenario). Under leveling, slipping one task can
 * move others that share its people, so the true slack can be smaller; a hard date can also forbid
 * a slip the pass allows. Float is therefore an estimate, mostly an upper bound (one rule below
 * errs low), and the UI says "about" and "estimate" (strings.ts), as ADR-0007 and phase-2.md 5.2
 * and 6.2 require.
 *
 * The rules:
 * - A task's late end is at most the finish and at most its parent's late end (a container bounds
 *   its descendants).
 * - An edge bounds its predecessor by the successor's late start (or late end, for `onend`) minus
 *   the gap, the way TaskJuggler's latestEnd walks a gap: `gaplength` back over working time, and
 *   `gapduration` back over calendar time, whichever is earlier. An edge from the predecessor's
 *   start (`onstart`) bounds its late start, so its late end is that plus its working span.
 * - A task's late start is its late end minus its scheduled working span. A container's is also at
 *   most its children's, since it starts with its first child. An edge from a container's start
 *   bounds the late start of the children that start with it, as the driving-path walk enters
 *   them (both could slip alone while the other holds the start; CPM cannot say "either", so this
 *   errs towards less float).
 * - A late end before the task's own end means the engine's dates and this arithmetic disagree; it
 *   is raised to the end (float 0) and counted in `clamped`. No golden plan that scheduled does
 *   that (the golden property tests check it); a failed run can.
 * - A container's float is the least float in its subtree: moving a summary moves all of it.
 *
 * Nodes are processed in a topological order of "needs" (Kahn). Nodes left over by a cycle, which
 * only a result that is not ok can hold, are then processed in pre-order with the values at hand.
 */
import type { Minutes } from '../../engine/protocol';
import type { Edge, Graph } from './graph';
import type { WorkingTime } from './working-time';

export interface LatePass {
	/** Late end per node: at least its end. */
	readonly lateEnd: Float64Array;
	/** Late start per node: at least its start. */
	readonly lateStart: Float64Array;
	/** Total float per node in working minutes (subtree minimum for containers), at least 0. */
	readonly float: Float64Array;
	/** Late ends raised to the task's own end by at least one slot. */
	readonly clamped: number;
	/** Nodes processed outside the topological order (cycles). */
	readonly cyclic: number;
}

/** The latest the predecessor's anchor may be, given the successor's late anchor `y`. */
export function latestUnder(e: Edge, y: Minutes, wt: WorkingTime): Minutes {
	const byLength = e.gapLength > 0 ? wt.addWorking(y, -e.gapLength) : y;
	return Math.min(byLength, y - e.gapDuration);
}

export function latePass(g: Graph, wt: WorkingTime): LatePass {
	const { n, start, end, container, parent, children, edges, out } = g;
	const finish = g.finish ?? 0;
	const res = wt.resolution;
	const span = new Float64Array(n);
	const lateEnd = new Float64Array(n);
	const lateStart = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		span[i] = Math.max(0, wt.workingBetween(start[i] as number, end[i] as number));
		lateEnd[i] = Math.max(end[i] as number, finish);
		lateStart[i] = Math.max(
			start[i] as number,
			wt.addWorking(lateEnd[i] as number, -(span[i] as number)),
		);
	}

	// Kahn over "needs": node i (late end) and n + i (a container's late start). The needs are
	// listed flat, then grouped by what is needed (CSR in typed arrays: no array per node).
	const total = 2 * n;
	const needer: number[] = [];
	const needed: number[] = [];
	const need = (x: number, y: number): void => {
		needer.push(x);
		needed.push(y);
	};
	for (const e of edges) need(e.pred, e.succEnd || !container[e.succ] ? e.succ : n + e.succ);
	for (let i = 0; i < n; i++) {
		const p = parent[i] as number;
		if (p >= 0) need(i, p);
		if (!container[i]) continue;
		need(n + i, i);
		for (const c of children[i] ?? []) need(n + i, container[c] ? n + c : c);
	}
	const indeg = new Int32Array(total);
	const first = new Int32Array(total + 1);
	for (let k = 0; k < needer.length; k++) {
		const x = needer[k] as number;
		const y = needed[k] as number;
		indeg[x] = (indeg[x] as number) + 1;
		first[y + 1] = (first[y + 1] as number) + 1;
	}
	for (let y = 0; y < total; y++) first[y + 1] = (first[y + 1] as number) + (first[y] as number);
	const dependents = new Int32Array(needer.length);
	const fill = first.slice(0, total);
	for (let k = 0; k < needer.length; k++) {
		const y = needed[k] as number;
		const at = fill[y] as number;
		dependents[at] = needer[k] as number;
		fill[y] = at + 1;
	}

	let clamped = 0;
	/** The latest start edges from a task's start allow, passed down to children that start with it. */
	const startBound = new Float64Array(n).fill(Infinity);
	const computeEnd = (i: number): void => {
		const e0 = end[i] as number;
		let le = finish;
		let sb = Infinity;
		const p = parent[i] as number;
		if (p >= 0) {
			le = Math.min(le, lateEnd[p] as number);
			const psb = startBound[p] as number;
			if (psb < Infinity && wt.workingBetween(start[p] as number, start[i] as number) < res)
				sb = psb;
		}
		for (const k of out[i] ?? []) {
			const e = edges[k] as Edge;
			const y = (e.succEnd ? lateEnd[e.succ] : lateStart[e.succ]) as number;
			const b = latestUnder(e, y, wt);
			if (e.predEnd) le = Math.min(le, b);
			else sb = Math.min(sb, b);
		}
		startBound[i] = sb;
		if (sb < Infinity) le = Math.min(le, wt.addWorking(sb, span[i] as number));
		if (le < e0) {
			if (wt.workingBetween(le, e0) >= res) clamped++;
			le = e0;
		}
		lateEnd[i] = le;
		if (!container[i]) {
			lateStart[i] = Math.max(start[i] as number, wt.addWorking(le, -(span[i] as number)));
		}
	};
	const computeStart = (i: number): void => {
		let ls = wt.addWorking(lateEnd[i] as number, -(span[i] as number));
		for (const c of children[i] ?? []) ls = Math.min(ls, lateStart[c] as number);
		lateStart[i] = Math.max(start[i] as number, ls);
	};
	const compute = (x: number): void => (x < n ? computeEnd(x) : computeStart(x - n));

	const done = new Uint8Array(total);
	const queue: number[] = [];
	for (let x = 0; x < total; x++) if (indeg[x] === 0 && (x < n || container[x - n])) queue.push(x);
	for (let q = 0; q < queue.length; q++) {
		const x = queue[q] as number;
		compute(x);
		done[x] = 1;
		for (let k = first[x] as number; k < (first[x + 1] as number); k++) {
			const d = dependents[k] as number;
			const left = (indeg[d] as number) - 1;
			indeg[d] = left;
			if (left === 0) queue.push(d);
		}
	}
	let cyclic = 0;
	for (let x = 0; x < total; x++) {
		if (done[x] || (x >= n && !container[x - n])) continue;
		compute(x);
		cyclic++;
	}

	// Float: own for every node, then the subtree minimum, children first (reverse pre-order).
	const float = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		float[i] = Math.max(0, wt.workingBetween(end[i] as number, lateEnd[i] as number));
	}
	for (let i = n - 1; i >= 0; i--) {
		const p = parent[i] as number;
		if (p >= 0 && (float[i] as number) < (float[p] as number)) float[p] = float[i] as number;
	}
	return { lateEnd, lateStart, float, clamped, cyclic };
}

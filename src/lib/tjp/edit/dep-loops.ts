// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * TaskJuggler's dependency loop check (TaskScenario.rb 3.8.4 `checkForLoops`, :628-787, run by
 * Project.rb :1104-1113) over one scenario's graph as dep-graph.ts builds it. Each task has a
 * start and an end node; the walk keeps the path of (task, end) pairs and its dead-end flags per
 * (task, end, from outside):
 *
 * - at a start from outside: a container goes to its children's starts (from outside); a leaf
 *   goes to its own end only in the forward pass of an ASAP task, or for a milestone;
 * - at a start from inside: to each start predecessor (at the end or start the dependency
 *   names, from outside), or, without any, to the parent's start (from inside);
 * - at an end, mirrored: children's ends; a leaf's own start only backward for ALAP or a
 *   milestone; end successors, else the parent's end.
 *
 * The forward pass starts at every top-level task's start, the backward pass, with fresh flags,
 * at every top-level task's end. Reaching a pair already on the path is a loop.
 *
 * That check misses loops it never walks into: an end is entered from inside only from a child
 * without successors, so `gui` (in `software`) depending on `test`, whose child `alpha` depends
 * on `software`, passes it, and TaskJuggler then recurses until the stack overflows (seen on the
 * Tutorial golden in the wasm engine): in `calcPathCriticalness` (TaskScenario.rb:897, and
 * :2415 in `calcPathCriticalnessEndSuccs`), which Project.rb:1123 runs after the loop check and
 * before scheduling. `hasCycle` is the plain test the edit API adds: a
 * cycle among the time points (a task's start before its end, a container around its
 * children, each dependency from the end or start it names). The two can differ the other way
 * too: a task that depends on its own parent's start is a `hasLoop` loop without a cycle (the
 * backward pass walks the dependency against its direction, then into the container), which
 * TaskJuggler also refuses as task_depend_parent.
 */
import type { TaskId } from '../index';

/** One task of the graph in one scenario. */
export interface LoopNode {
	readonly id: TaskId;
	readonly parent: TaskId | null;
	readonly children: readonly TaskId[];
	/** ASAP (`forward` in TaskJuggler). */
	readonly forward: boolean;
	readonly milestone: boolean;
	/** (task, at its end) pairs. */
	readonly startpreds: [TaskId, boolean][];
	readonly endsuccs: [TaskId, boolean][];
}

/**
 * The graph by integer index, so the walks below use typed arrays instead of string keys: node
 * `i`'s start is time point `2i`, its end `2i + 1`. A name the graph does not hold is -1 in the
 * lists: it still counts there (a dependency on it keeps TaskJuggler's walk from going on to the
 * parent), and a visit to it finds nothing.
 */
interface Indexed {
	readonly n: number;
	readonly parent: Int32Array;
	readonly children: readonly number[][];
	readonly forward: Uint8Array;
	readonly milestone: Uint8Array;
	/** (index, at its end) pairs. */
	readonly startpreds: readonly [number, boolean][][];
	readonly endsuccs: readonly [number, boolean][][];
	readonly roots: readonly number[];
}

function indexed(nodes: ReadonlyMap<TaskId, LoopNode>): Indexed {
	const list = [...nodes.values()];
	const ix = new Map<TaskId, number>();
	list.forEach((t, i) => ix.set(t.id, i));
	const n = list.length;
	const parent = new Int32Array(n).fill(-1);
	const forward = new Uint8Array(n);
	const milestone = new Uint8Array(n);
	const pairs = (xs: readonly [TaskId, boolean][]): [number, boolean][] => {
		const out: [number, boolean][] = [];
		for (const [x, e] of xs) out.push([ix.get(x) ?? -1, e]);
		return out;
	};
	const children: number[][] = [];
	const startpreds: [number, boolean][][] = [];
	const endsuccs: [number, boolean][][] = [];
	const roots: number[] = [];
	list.forEach((t, i) => {
		const p = t.parent === null ? undefined : ix.get(t.parent);
		if (p !== undefined) parent[i] = p;
		if (t.parent === null) roots.push(i);
		forward[i] = t.forward ? 1 : 0;
		milestone[i] = t.milestone ? 1 : 0;
		children.push(t.children.map((c) => ix.get(c) ?? -1));
		startpreds.push(pairs(t.startpreds));
		endsuccs.push(pairs(t.endsuccs));
	});
	return { n, parent, children, forward, milestone, startpreds, endsuccs, roots };
}

/** Whether the loop check (module comment) finds a loop. */
export function hasLoop(nodes: ReadonlyMap<TaskId, LoopNode>): boolean {
	const g = indexed(nodes);
	// Per time point: on the walk's path; per (time point, from outside): a dead end.
	const onPath = new Uint8Array(2 * g.n);
	let dead = new Uint8Array(4 * g.n);
	const visit = (i: number, atEnd: boolean, outside: boolean, forward: boolean): boolean => {
		if (i < 0) return false;
		const here = 2 * i + (atEnd ? 1 : 0);
		if (onPath[here]) return true;
		const flag = 2 * here + (outside ? 1 : 0);
		if (dead[flag]) return false;
		onPath[here] = 1;
		const each = (list: readonly [number, boolean][]): boolean =>
			list.some(([x, e]) => visit(x, e, true, forward));
		const kids = (end: boolean): boolean =>
			(g.children[i] ?? []).some((c) => visit(c, end, true, forward));
		const children = g.children[i]?.length ?? 0;
		const own = g.forward[i] === 1;
		const milestone = g.milestone[i] === 1;
		const parent = g.parent[i] ?? -1;
		let loop = false;
		if (!atEnd) {
			const preds = g.startpreds[i] ?? [];
			if (outside) {
				if (children > 0) loop = kids(false);
				else if ((forward && own) || milestone) loop = visit(i, true, false, forward);
			} else if (preds.length === 0) {
				loop = parent >= 0 && visit(parent, false, false, forward);
			} else loop = each(preds);
		} else if (outside) {
			if (children > 0) loop = kids(true);
			else if ((!forward && !own) || milestone) loop = visit(i, false, false, forward);
		} else {
			const succs = g.endsuccs[i] ?? [];
			if (succs.length === 0) loop = parent >= 0 && visit(parent, true, false, forward);
			else loop = each(succs);
		}
		if (loop) return true;
		onPath[here] = 0;
		dead[flag] = 1;
		return false;
	};
	for (const r of g.roots) if (visit(r, false, true, true)) return true;
	dead = new Uint8Array(4 * g.n);
	for (const r of g.roots) if (visit(r, true, true, false)) return true;
	return false;
}

/** Whether the time points (module comment) form a cycle; iterative, for deep plans. */
export function hasCycle(nodes: ReadonlyMap<TaskId, LoopNode>): boolean {
	const g = indexed(nodes);
	const next: number[][] = Array.from({ length: 2 * g.n }, () => []);
	const edge = (a: number, b: number): void => {
		next[a]?.push(b);
	};
	const point = (i: number, end: boolean): number => 2 * i + (end ? 1 : 0);
	for (let i = 0; i < g.n; i++) {
		edge(point(i, false), point(i, true));
		const p = g.parent[i] ?? -1;
		if (p >= 0) {
			edge(point(p, false), point(i, false));
			edge(point(i, true), point(p, true));
		}
		for (const [x, e] of g.startpreds[i] ?? []) if (x >= 0) edge(point(x, e), point(i, false));
		for (const [x, e] of g.endsuccs[i] ?? []) if (x >= 0) edge(point(i, true), point(x, e));
	}
	// 0: not seen, 1: on the stack, 2: done.
	const state = new Uint8Array(2 * g.n);
	const at: number[] = [];
	const pos: number[] = [];
	for (let start = 0; start < 2 * g.n; start++) {
		if (state[start]) continue;
		at.push(start);
		pos.push(0);
		state[start] = 1;
		while (at.length > 0) {
			const top = at.length - 1;
			const here = at[top] as number;
			const k = pos[top] as number;
			const out = next[here] ?? [];
			if (k >= out.length) {
				state[here] = 2;
				at.pop();
				pos.pop();
				continue;
			}
			pos[top] = k + 1;
			const to = out[k] as number;
			if (state[to] === 1) return true;
			if (state[to] === 0) {
				state[to] = 1;
				at.push(to);
				pos.push(0);
			}
		}
	}
	return false;
}

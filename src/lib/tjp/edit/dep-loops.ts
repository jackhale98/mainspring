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
 * children, each dependency from the end or start it names). Every loop `hasLoop` finds is one
 * of these, since its walk follows those edges in one direction per pass.
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

/** Whether the loop check (module comment) finds a loop. */
export function hasLoop(nodes: ReadonlyMap<TaskId, LoopNode>): boolean {
	const onPath = new Set<string>();
	let dead = new Set<string>();
	const visit = (id: TaskId, atEnd: boolean, outside: boolean, forward: boolean): boolean => {
		const t = nodes.get(id);
		if (!t) return false;
		const here = `${id}\0${atEnd}`;
		if (onPath.has(here)) return true;
		const flag = `${here}\0${outside}`;
		if (dead.has(flag)) return false;
		onPath.add(here);
		const each = (list: readonly [TaskId, boolean][]): boolean =>
			list.some(([x, e]) => visit(x, e, true, forward));
		const kids = (end: boolean): boolean => t.children.some((c) => visit(c, end, true, forward));
		let loop = false;
		if (!atEnd) {
			if (outside) {
				if (t.children.length > 0) loop = kids(false);
				else if ((forward && t.forward) || t.milestone) loop = visit(id, true, false, forward);
			} else if (t.startpreds.length === 0) {
				loop = t.parent !== null && visit(t.parent, false, false, forward);
			} else loop = each(t.startpreds);
		} else if (outside) {
			if (t.children.length > 0) loop = kids(true);
			else if ((!forward && !t.forward) || t.milestone) loop = visit(id, false, false, forward);
		} else if (t.endsuccs.length === 0) {
			loop = t.parent !== null && visit(t.parent, true, false, forward);
		} else loop = each(t.endsuccs);
		if (loop) return true;
		onPath.delete(here);
		dead.add(flag);
		return false;
	};
	const roots = [...nodes.values()].filter((n) => n.parent === null);
	for (const r of roots) if (visit(r.id, false, true, true)) return true;
	dead = new Set();
	for (const r of roots) if (visit(r.id, true, true, false)) return true;
	return false;
}

/** Whether the time points (module comment) form a cycle; iterative, for deep plans. */
export function hasCycle(nodes: ReadonlyMap<TaskId, LoopNode>): boolean {
	const key = (id: TaskId, end: boolean): string => `${id}\0${end ? 1 : 0}`;
	const next = new Map<string, string[]>();
	const edge = (a: string, b: string): void => {
		const list = next.get(a);
		if (list) list.push(b);
		else next.set(a, [b]);
	};
	for (const t of nodes.values()) {
		edge(key(t.id, false), key(t.id, true));
		if (t.parent !== null && nodes.has(t.parent)) {
			edge(key(t.parent, false), key(t.id, false));
			edge(key(t.id, true), key(t.parent, true));
		}
		for (const [p, e] of t.startpreds) if (nodes.has(p)) edge(key(p, e), key(t.id, false));
		for (const [s, e] of t.endsuccs) if (nodes.has(s)) edge(key(t.id, true), key(s, e));
	}
	const state = new Map<string, 1 | 2>();
	for (const start of next.keys()) {
		if (state.has(start)) continue;
		const stack: Array<{ at: string; i: number }> = [{ at: start, i: 0 }];
		state.set(start, 1);
		while (stack.length > 0) {
			const top = stack[stack.length - 1];
			if (!top) break;
			const out = next.get(top.at) ?? [];
			const to = out[top.i++];
			if (to === undefined) {
				state.set(top.at, 2);
				stack.pop();
				continue;
			}
			const s = state.get(to);
			if (s === 1) return true;
			if (s === undefined) {
				state.set(to, 1);
				stack.push({ at: to, i: 0 });
			}
		}
	}
	return false;
}

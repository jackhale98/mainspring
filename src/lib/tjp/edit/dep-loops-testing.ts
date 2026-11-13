// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The string-keyed loop walks that dep-loops.ts replaced with typed arrays (phase-2 T6), kept as
 * the oracle for dep-loops.property.test.ts: both must answer alike on every graph.
 */
import type { TaskId } from '../index';
import type { LoopNode } from './dep-loops';

export function referenceHasLoop(nodes: ReadonlyMap<TaskId, LoopNode>): boolean {
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

export function referenceHasCycle(nodes: ReadonlyMap<TaskId, LoopNode>): boolean {
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

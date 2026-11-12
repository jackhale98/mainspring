// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Manager loops (phase-1.md 15.22). TaskJuggler follows `managers` recursively when it collects a
 * resource's reports (ResourceScenario#setReports_i, called for every resource from
 * Project#prepareScenario): a loop reached from any resource recurses until the stack overflows
 * (natively `stack level too deep`; in the wasm engine a dead worker). A resource's managers are
 * its own `managers` ids plus every ancestor's (a group's managers apply to its subtree; counting
 * every ancestor statement, not only those read before the child, is conservative).
 *
 * `managerLoop` takes the change an intent makes to the graph (new own lists, new parents, a new
 * resource) and refuses with `cycle` when an edge the change adds leads to a loop, whether the
 * edge closes it or only reaches one that is already there. Every loop is refused, not only those
 * an outside resource reports into: that is simpler and always safe.
 */
import type { SourceRange, SymbolIndex } from '../index';
import { refused, type Refused } from './types';

/** How an intent changes the managers graph. */
export interface ManagerChange {
	/** Resources whose own `managers` ids become these. */
	readonly own?: ReadonlyMap<string, readonly string[]>;
	/** Resources that move under these parents (null: a root). */
	readonly parent?: ReadonlyMap<string, string | null>;
	/** A resource the intent adds (no one names it yet). */
	readonly added?: {
		readonly id: string;
		readonly parent: string | null;
		readonly own: readonly string[];
	};
}

/** Own manager ids per resource, from the resolved `managers` references. */
export function ownManagers(index: SymbolIndex): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const r of index.references) {
		if (r.via !== 'managers' || r.kind !== 'resource' || r.target === null) continue;
		if (r.owner === null || !index.resources.has(r.owner)) continue;
		const list = out.get(r.owner) ?? [];
		if (!list.includes(r.target)) list.push(r.target);
		out.set(r.owner, list);
	}
	return out;
}

interface Graph {
	readonly own: (id: string) => readonly string[];
	readonly parent: (id: string) => string | null;
}

function graphBefore(index: SymbolIndex, own: ReadonlyMap<string, readonly string[]>): Graph {
	return {
		own: (id) => own.get(id) ?? [],
		parent: (id) => index.resources.get(id)?.parent ?? null,
	};
}

function graphAfter(before: Graph, change: ManagerChange): Graph {
	const add = change.added;
	return {
		own: (id) => (add?.id === id ? add.own : (change.own?.get(id) ?? before.own(id))),
		parent: (id) => {
			if (add?.id === id) return add.parent;
			const moved = change.parent?.get(id);
			return moved !== undefined ? moved : before.parent(id);
		},
	};
}

/** Own ids and every ancestor's (module comment). */
function managersOf(g: Graph, id: string): Set<string> {
	const out = new Set<string>();
	const seen = new Set<string>();
	for (let r: string | null = id; r !== null && !seen.has(r); r = g.parent(r)) {
		seen.add(r);
		for (const m of g.own(r)) out.add(m);
	}
	return out;
}

/** The members of a loop reachable from `start`, or null. */
function loopFrom(g: Graph, start: string): string[] | null {
	const state = new Map<string, 'open' | 'done'>();
	const path: string[] = [];
	const visit = (id: string): string[] | null => {
		const s = state.get(id);
		if (s === 'done') return null;
		if (s === 'open') return path.slice(path.indexOf(id));
		state.set(id, 'open');
		path.push(id);
		for (const m of managersOf(g, id)) {
			const loop = visit(m);
			if (loop) return loop;
		}
		path.pop();
		state.set(id, 'done');
		return null;
	};
	return visit(start);
}

/** The resources whose managers the change may alter: the changed ones and their subtrees. */
function touched(index: SymbolIndex, change: ManagerChange): string[] {
	const roots = [...(change.own?.keys() ?? []), ...(change.parent?.keys() ?? [])];
	const out = new Set<string>(change.added ? [change.added.id] : []);
	const walk = (id: string): void => {
		if (out.has(id)) return;
		out.add(id);
		for (const c of index.resources.get(id)?.children ?? []) walk(c);
	};
	for (const r of roots) walk(r);
	return [...out];
}

/**
 * `cycle` at the declarations of a loop that an edge added by `change` reaches (module comment),
 * or null.
 */
export function managerLoop(index: SymbolIndex, change: ManagerChange): Refused | null {
	const before = graphBefore(index, ownManagers(index));
	const after = graphAfter(before, change);
	for (const id of touched(index, change)) {
		const had = change.added?.id === id ? new Set<string>() : managersOf(before, id);
		for (const m of managersOf(after, id)) {
			if (had.has(m)) continue;
			const loop = loopFrom(after, m);
			if (!loop) continue;
			const at: SourceRange[] = loop.flatMap((x) => {
				const s = index.resources.get(x);
				return s ? [s.decl.header] : [];
			});
			return refused('cycle', at);
		}
	}
	return null;
}

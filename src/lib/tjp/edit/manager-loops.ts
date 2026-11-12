// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Manager loops (phase-1.md 15.22). TaskJuggler follows `managers` recursively when it collects a
 * resource's reports (ResourceScenario#setReports_i, called for every resource from
 * Project#prepareScenario): a loop reached from any resource recurses until the stack overflows
 * (natively `stack level too deep`; in the wasm engine a dead worker). A resource's managers are
 * its own `managers` ids plus those it inherits: TaskJuggler copies the parent's value when it
 * creates the child (PropertyTreeNode#inheritAttributes), so only ancestor statements read before
 * the child count.
 *
 * `managerLoop` takes the change an intent makes to the graph (new own lists, new parents, a new
 * resource) and refuses with `cycle` when an edge the change adds leads to a loop, whether the
 * edge closes it or only reaches one that is already there. Both sides are bounded so that no new
 * edge is missed: the graph after the change is an upper bound (every ancestor statement counts,
 * wherever it is read), and the managers a changed resource had before are a lower bound (only
 * the ancestor statements read before the child on the path, `managersHad`). Every loop is
 * refused, not only those an outside resource reports into: that is simpler and always safe.
 */
import type { ReferenceSite, SourceRange, SymbolIndex } from '../index';
import { readBefore, resourceAncestors } from './props';
import { refused, type EditContext, type Refused } from './types';

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

/** Whether a `managers` reference lies in an unprefixed statement of its owner (every scenario). */
function inEveryScenario(ctx: EditContext, r: ReferenceSite): boolean {
	const owner = r.owner === null ? undefined : ctx.index.resources.get(r.owner);
	const site = owner?.attrs.find(
		(a) =>
			a.keyword === 'managers' &&
			a.statement.file === r.at.file &&
			a.statement.from <= r.at.from &&
			r.at.to <= a.statement.to,
	);
	return site !== undefined && site.scenario === null;
}

/**
 * The managers `id` surely has now in every scenario (lower bound, module comment): its own ids,
 * and each ancestor's ids from statements read before its child on the path was declared. Only
 * unprefixed statements count: `managers` is scenario specific (Project.rb:222), so `s1:managers`
 * holds in one scenario only. (The upper bound counts prefixed statements as present everywhere.)
 */
function managersHad(ctx: EditContext, id: string): Set<string> {
	const out = new Set<string>();
	const sym = ctx.index.resources.get(id);
	if (!sym) return out;
	const refs = ctx.index.references.filter(
		(r) =>
			r.via === 'managers' && r.kind === 'resource' && r.target !== null && inEveryScenario(ctx, r),
	);
	for (const r of refs) if (r.owner === id && r.target !== null) out.add(r.target);
	for (const step of resourceAncestors(ctx, sym)) {
		for (const r of refs) {
			if (r.owner !== step.res.id || r.target === null) continue;
			if (readBefore(ctx, r.at, step.before)) out.add(r.target);
		}
	}
	return out;
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
export function managerLoop(ctx: EditContext, change: ManagerChange): Refused | null {
	const { index } = ctx;
	const before = graphBefore(index, ownManagers(index));
	const after = graphAfter(before, change);
	for (const id of touched(index, change)) {
		const had = change.added?.id === id ? new Set<string>() : managersHad(ctx, id);
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

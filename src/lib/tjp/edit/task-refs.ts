// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * References for `deleteTask` and `moveTask` (phase-1.md 7.1; 5.4 References; ADR-0003 #7).
 *
 * Moving `old` to `next` maps every id of its subtree (`old.x` → `next.x`). A task reference
 * changes when its target or its owner (the task whose body or supplement holds it) is in the
 * subtree:
 *
 * - `depends`/`precedes`: the written form is kept while it still names the mapped target from
 *   the mapped owner (refs.ts `rewrittenRef`); otherwise `!id` for a sibling, else the absolute id.
 * - `supplement task <path>`: the path is read below its base (the enclosing task, else the
 *   task prefix); it is rewritten below the same base (mapped when the supplement moves too).
 *   When the new id is not below that base, the reference cannot be fixed.
 * - Unfixable (`unfixable-reference`): `taskprefix` uses, mentions in macro bodies and opaque
 *   statements (`SymbolIndex.mentions`, conservative), a reference whose token is text-only, an
 *   unresolved reference that the move could change (relative in the moved block, or written
 *   into the subtree), and, inside the moved block, opaque statements or called macros whose text
 *   holds a `!` (a relative reference the index cannot see).
 *
 * References inside the moved block are rewritten in the moved text (`inner`), the others in
 * place (`outer`). When the ids do not change (a reorder, or a move to the same parent in another
 * place) nothing is rewritten.
 *
 * Deleting removes the subtree's `depends`/`precedes` items elsewhere (list rules; a statement
 * that would be left empty goes whole) and refuses the unfixable ones (refs.ts
 * `unfixableReferences`, with the removed blocks ignored).
 */
import type { DependencySite, ReferenceSite, SourceRange, SymbolIndex } from '../index';
import { parseTaskRef } from '../values';
import { checkReferences, dependenciesNaming, rewrittenRef } from './refs';
import { refused, type Refused, type Span } from './types';

export interface Rewrite {
	readonly at: SourceRange;
	readonly insert: string;
}

export interface MoveRewrites {
	readonly inner: readonly Rewrite[];
	readonly outer: readonly Rewrite[];
}

const within = (r: SourceRange, o: SourceRange): boolean =>
	r.file === o.file && o.from <= r.from && r.to <= o.to;

const key = (r: SourceRange): string => `${r.file}\0${r.from}\0${r.to}`;

/** The id map of a move: the subtree of `old` below `next`. */
export function idMap(old: string, next: string): (id: string) => string {
	return (id) => (id === old || id.startsWith(`${old}.`) ? next + id.slice(old.length) : id);
}

/** The new written path of a supplement reference, or null when none names the new target. */
function supplementPath(
	r: ReferenceSite,
	target: string,
	map: (id: string) => string,
	moves: boolean,
): string | null | false {
	const w = r.written;
	let base: string | null;
	if (target === w) base = null;
	else if (target.endsWith(`.${w}`)) base = target.slice(0, -(w.length + 1));
	else return false;
	const nextBase = moves && base !== null ? map(base) : base;
	const nextTarget = map(target);
	if (nextBase === null) return nextTarget === w ? null : nextTarget;
	if (!nextTarget.startsWith(`${nextBase}.`)) return false;
	const rest = nextTarget.slice(nextBase.length + 1);
	return rest === w ? null : rest;
}

/** Whether an unresolved reference may name something the move changes. */
function mayChange(
	r: ReferenceSite,
	old: string,
	subtree: ReadonlySet<string>,
	moves: boolean,
): boolean {
	if (r.owner !== null && subtree.has(r.owner)) return true;
	const p = parseTaskRef(r.written.trim());
	if (!p.ok) return moves;
	if (p.value.up > 0) return moves;
	const path = p.value.path;
	return path === old || path.startsWith(`${old}.`);
}

/**
 * The rewrites of a move (module comment), or `unfixable-reference`. `block` is the moved text
 * (the block with its leading comments).
 */
export function moveRewrites(
	index: SymbolIndex,
	old: string,
	next: string,
	subtree: readonly string[],
	block: SourceRange,
): MoveRewrites | Refused {
	const inner: Rewrite[] = [];
	const outer: Rewrite[] = [];
	if (old === next) return { inner, outer };
	const set = new Set(subtree);
	const map = idMap(old, next);
	const bad: SourceRange[] = [];
	const seen = new Set<string>();
	for (const id of subtree) for (const m of index.mentions('task', id)) bad.push(m.at);
	for (const r of index.references) {
		if (r.kind !== 'task' || seen.has(key(r.at))) continue;
		seen.add(key(r.at));
		const moves = within(r.at, block);
		const t = r.target;
		if (t === null) {
			if (mayChange(r, old, set, moves)) bad.push(r.at);
			continue;
		}
		const ownerMoves = r.owner !== null && set.has(r.owner);
		if (!set.has(t) && !ownerMoves) continue;
		let insert: string | null;
		if (r.via === 'depends' || r.via === 'precedes') {
			insert = rewrittenRef(r.written, r.owner === null ? null : map(r.owner), map(t));
		} else if (r.via === 'supplement') {
			const p = supplementPath(r, t, map, moves);
			if (p === false) {
				bad.push(r.at);
				continue;
			}
			insert = p;
		} else {
			bad.push(r.at);
			continue;
		}
		if (insert === null) continue;
		if (index.blocking(r.at.file, r.at.from, r.at.to) || /[\r\n]/.test(r.written)) {
			bad.push(r.at);
			continue;
		}
		(moves ? inner : outer).push({ at: r.at, insert });
	}
	if (bad.length > 0) return refused('unfixable-reference', dedupe(bad));
	return { inner, outer };
}

function dedupe(list: readonly SourceRange[]): SourceRange[] {
	const seen = new Set<string>();
	return list.filter((r) => (seen.has(key(r)) ? false : (seen.add(key(r)), true)));
}

/** A dependency statement to edit for a delete: the items to drop, or the whole statement. */
export interface DependencyFix {
	readonly statement: SourceRange;
	/** All item ranges of the statement, in order. */
	readonly items: readonly Span[];
	/** Indices into `items` to remove. */
	readonly remove: readonly number[];
}

/**
 * The dependency items naming the subtree outside the removed ranges, per statement, or
 * `unfixable-reference` (module comment).
 */
export function deleteFixes(
	index: SymbolIndex,
	subtree: readonly string[],
	removed: readonly SourceRange[],
): DependencyFix[] | Refused {
	const unfixable = checkReferences(index, 'task', subtree, removed);
	if (unfixable) return unfixable;
	const gone = (r: SourceRange): boolean => removed.some((o) => within(r, o));
	const byStatement = new Map<string, { statement: SourceRange; drop: Set<string> }>();
	for (const d of dependenciesNaming(index, subtree)) {
		if (gone(d.item)) continue;
		const k = key(d.statement);
		const entry = byStatement.get(k) ?? { statement: d.statement, drop: new Set<string>() };
		entry.drop.add(key(d.item));
		byStatement.set(k, entry);
	}
	const out: DependencyFix[] = [];
	for (const [k, { statement, drop }] of byStatement) {
		const all = new Map<string, DependencySite>();
		for (const d of index.dependencies) if (key(d.statement) === k) all.set(key(d.item), d);
		const items = [...all.values()].map((d) => d.item).sort((a, b) => a.from - b.from);
		const remove = items.flatMap((it, i) => (drop.has(key(it)) ? [i] : []));
		out.push({ statement, items: items.map((i) => ({ from: i.from, to: i.to })), remove });
	}
	return out;
}

const below = (x: string, y: string): boolean => x.startsWith(`${y}.`);

/**
 * `cycle` when the move would make a task depend on its own ancestor or descendant, which
 * TaskJuggler rejects (`task_depend_parent`, `task_depend_child`, TaskScenario.rb).
 */
export function checkAncestry(index: SymbolIndex, map: (id: string) => string): Refused | null {
	const at: SourceRange[] = [];
	for (const d of index.dependencies) {
		if (d.pred === null || d.succ === null) continue;
		const [p, s] = [map(d.pred), map(d.succ)];
		const now = below(p, s) || below(s, p);
		const was = below(d.pred, d.succ) || below(d.succ, d.pred);
		if (now && !was) at.push(d.item);
	}
	return at.length > 0 ? refused('cycle', dedupe(at)) : null;
}

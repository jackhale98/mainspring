// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * References for the edit intents (phase-1.md 5.4 References, 7.1; ADR-0003 #7).
 *
 * - Writing a task reference: `!id` when the referencing task (the one whose body or supplement
 *   holds the reference) and the target are siblings, else the absolute id (`taskRefText`).
 *   Absolute ids get no task prefix in TaskJuggler (rule_taskDepId), so the full id is written.
 * - Keeping a reference: `rewrittenRef` returns null while the written form still resolves to the
 *   target from its owner (resolved as rule_taskDepId does), so references whose meaning does not
 *   change keep their spelling; otherwise the form above.
 * - Finding references: `references` over the index's `ReferenceSite`s of a kind (all files,
 *   all include visits), `dependenciesNaming` for the depends/precedes items that name tasks.
 * - References the edit API cannot fix (`unfixable-reference`): mentions in macro bodies and
 *   opaque statements (`SymbolIndex.mentions`), references in text-only text, and `taskprefix` /
 *   `resourceprefix` uses, except inside ranges the edit removes whole (`ignore`).
 */
import type {
	DependencySite,
	PropertyKind,
	ReferenceSite,
	SourceRange,
	SymbolIndex,
	TaskId,
} from '../index';
import { parseTaskRef, printTaskRef, refFor, resolveTaskRef } from '../values';
import { refused, type Refused } from './types';

/** The reference to write in `owner`'s body (null: outside any task) for `target`. */
export function taskRefText(owner: TaskId | null, target: TaskId): string {
	if (owner === null) return target;
	const r = printTaskRef(refFor(owner, target));
	return r.ok ? r.value : target;
}

/** Whether a written task reference, read in `owner`, names `target`. */
export function resolvesTo(written: string, owner: TaskId | null, target: TaskId): boolean {
	const p = parseTaskRef(written.trim());
	if (!p.ok) return false;
	if (p.value.up === 0) return p.value.path === target;
	if (owner === null) return false;
	const r = resolveTaskRef(p.value, owner);
	return r.ok && r.value === target;
}

/** The new text for a reference that must name `target` from `owner`, or null to keep it. */
export function rewrittenRef(written: string, owner: TaskId | null, target: TaskId): string | null {
	return resolvesTo(written, owner, target) ? null : taskRefText(owner, target);
}

/** `id` and its descendants, in pre-order. */
export function subtree(index: SymbolIndex, kind: PropertyKind, id: string): string[] {
	const map = kind === 'task' ? index.tasks : index.resources;
	const out: string[] = [];
	const walk = (x: string): void => {
		const sym = map.get(x);
		if (!sym) return;
		out.push(x);
		for (const c of sym.children) walk(c);
	};
	walk(id);
	return out;
}

const asSet = (ids: Iterable<string> | string): ReadonlySet<string> =>
	typeof ids === 'string' ? new Set([ids]) : new Set(ids);

/** References of `kind` (any `via`) that resolve to one of `ids`, in index order. */
export function references(
	index: SymbolIndex,
	kind: ReferenceSite['kind'],
	ids: Iterable<string> | string,
): ReferenceSite[] {
	const set = asSet(ids);
	return index.references.filter((r) => r.kind === kind && r.target !== null && set.has(r.target));
}

/**
 * Dependency items that name one of `ids` as the other end: `depends` items whose predecessor
 * and `precedes` items whose successor is in `ids`.
 */
export function dependenciesNaming(
	index: SymbolIndex,
	ids: Iterable<string> | string,
): DependencySite[] {
	const set = asSet(ids);
	return index.dependencies.filter((d) => {
		const named = d.form === 'depends' ? d.pred : d.succ;
		return named !== null && set.has(named);
	});
}

/** Dependency items written in the task's own declaration and supplement bodies. */
export function dependenciesOf(index: SymbolIndex, task: TaskId): DependencySite[] {
	return index.dependencies.filter((d) => (d.form === 'depends' ? d.succ : d.pred) === task);
}

const inside = (r: SourceRange, outer: readonly SourceRange[]): boolean =>
	outer.some((o) => o.file === r.file && o.from <= r.from && r.to <= o.to);

/** Ranges that mention or reference `ids` where the edit API cannot fix them (module comment). */
export function unfixableReferences(
	index: SymbolIndex,
	kind: PropertyKind,
	ids: Iterable<string> | string,
	ignore: readonly SourceRange[] = [],
): SourceRange[] {
	const set = asSet(ids);
	const out: SourceRange[] = [];
	for (const id of set) for (const m of index.mentions(kind, id)) out.push(m.at);
	for (const r of references(index, kind, set)) {
		if (r.textOnly || r.via === 'taskprefix' || r.via === 'resourceprefix') out.push(r.at);
	}
	const seen = new Set<string>();
	return out.filter((r) => {
		const k = `${r.file}\0${r.from}\0${r.to}`;
		if (seen.has(k) || inside(r, ignore)) return false;
		seen.add(k);
		return true;
	});
}

/** `unfixable-reference` at those ranges, or null. */
export function checkReferences(
	index: SymbolIndex,
	kind: PropertyKind,
	ids: Iterable<string> | string,
	ignore: readonly SourceRange[] = [],
): Refused | null {
	const at = unfixableReferences(index, kind, ids, ignore);
	return at.length > 0 ? refused('unfixable-reference', at) : null;
}

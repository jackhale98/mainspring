// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The link between two tasks as the dependency intents (deps.ts, deps-gap.ts) see it: both ends,
 * the own items that make it (the successor's `depends` items naming the predecessor and the
 * predecessor's `precedes` items naming the successor), and links inherited from a parent's
 * list (TaskJuggler copies `depends` and `precedes` to a child when it is declared).
 */
import type { DependencySite, SymbolIndex, TaskId, TaskSymbol } from '../index';
import { taskState, topScenario } from './dep-graph';
import { checkBodyMacros } from './lists';
import { refused, type EditContext, type Refused, type SourceRange } from './types';

/** True for no prefix or the top scenario's (5.4: the same as none). */
export function unprefixed(index: SymbolIndex, scenario: string | null): boolean {
	return scenario === null || scenario === index.scenarios[0]?.id;
}

/**
 * Both tasks of a link, or the refusal for a missing or expansion-only one, or `macro-in-body`
 * when a body macro may write the successor's `depends` or the predecessor's `precedes`.
 */
export function linkTasks(
	ctx: EditContext,
	task: TaskId,
	target: TaskId,
): { succ: TaskSymbol; pred: TaskSymbol } | Refused {
	const { ws, index } = ctx;
	const succ = index.tasks.get(task);
	const pred = index.tasks.get(target);
	if (!succ || !pred) {
		const known = succ ?? pred;
		return refused('unknown-target', known ? [known.decl.header] : []);
	}
	for (const s of [succ, pred]) {
		if (s.expandedOnly) return refused('text-only', [s.decl.block], { textOnly: 'expanded-only' });
	}
	// A body macro that may write the link's lists hides items the edit can neither see nor fix.
	const hidden =
		checkBodyMacros(ws, index, succ, ['depends']) ?? checkBodyMacros(ws, index, pred, ['precedes']);
	return hidden ?? { succ, pred };
}

export const rangeKey = (r: SourceRange): string => `${r.file}\0${r.from}\0${r.to}`;

/** Own items linking `pred` to `succ` (module comment), once per item range. */
export function linkItems(index: SymbolIndex, succ: TaskId, pred: TaskId): DependencySite[] {
	const seen = new Set<string>();
	const out: DependencySite[] = [];
	// The index sets a site's own end (succ of `depends`, pred of `precedes`) to the task whose
	// body holds it, so matching both ends finds exactly the own items.
	for (const d of index.dependencies) {
		if (d.succ !== succ || d.pred !== pred || seen.has(rangeKey(d.item))) continue;
		seen.add(rangeKey(d.item));
		out.push(d);
	}
	return out;
}

/** Whether `a` is a proper ancestor of `b`. */
export function isAncestor(index: SymbolIndex, a: TaskId, b: TaskId): boolean {
	for (
		let p = index.tasks.get(b)?.parent ?? null;
		p !== null;
		p = index.tasks.get(p)?.parent ?? null
	)
		if (p === a) return true;
	return false;
}

/** Whether the link comes from a list a task inherited from an ancestor (top scenario). */
export function inheritedLink(ctx: EditContext, succ: TaskId, pred: TaskId): boolean {
	const top = topScenario(ctx.index);
	const s = taskState(ctx.ws, ctx.index, succ, top).inherited;
	const p = taskState(ctx.ws, ctx.index, pred, top).inherited;
	return (
		(s?.depends.some((d) => d.target === pred) ?? false) ||
		(p?.precedes.some((d) => d.target === succ) ?? false)
	);
}

/** Items in the ancestors' bodies that an inherited link comes from. */
export function inheritedItems(index: SymbolIndex, succ: TaskId, pred: TaskId): SourceRange[] {
	return index.dependencies
		.filter((d) =>
			d.form === 'depends'
				? d.pred === pred && d.succ !== null && isAncestor(index, d.succ, succ)
				: d.succ === succ && d.pred !== null && isAncestor(index, d.pred, pred),
		)
		.map((d) => d.item);
}

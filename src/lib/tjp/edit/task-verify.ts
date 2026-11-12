// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The last check of the task tree intents: the edited workspace is indexed again and must give
 * the tree the intent asks for, with every reference still naming its (mapped) target. This
 * catches what the text rules cannot see in advance: a block that lands where TaskJuggler gives
 * it another parent (prefixed includes, 15.8), a supplement or `allocate` that would come before
 * the declaration it needs, a reference that resolves differently.
 *
 * The edit's own index is the "before" side. The "after" index gets that index's engine hints
 * carried through the edit (task-hints.ts), so ids written with macros (Fedora's) stay resolved
 * where their header lines are untouched. An id resolved only through a hint that the edit drops
 * (a header in the moved block) cannot be checked, so it is left out of the comparison, with the
 * references that name it; ids the text declares are always compared.
 *
 * A mismatch refuses the intent (`unfixable-reference` for moves and deletes, `unsupported-form`
 * for additions) at the given ranges, except for late declarations, which get their own reason: a
 * flag used before its declaration (`undeclared-flag`, at the flag), an `allocate` read before its
 * resource's declaration (`unknown-target`, as the allocation intents), a supplement before the
 * declaration it names (`unfixable-reference`, at the supplement path).
 */
import type { ChangeSet } from '@codemirror/state';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import { buildIncludeGraph } from '../../workspace/includes';
import { pathLookup } from '../../workspace/paths';
import { changeSetOf, updateFile, withTop, type TjpFile } from '../document';
import { buildIndex, type SymbolIndex, type TaskId } from '../index';
import { mapHints } from './task-hints';
import {
	refused,
	type EditContext,
	type EditOp,
	type RefusalReason,
	type Refused,
	type SourceRange,
} from './types';

export interface After {
	readonly snap: WorkspaceSnapshot;
	/** The change set of each changed file. */
	readonly changes: ReadonlyMap<string, ChangeSet>;
}

/** The snapshot the ops give (no version bump: it is only indexed). */
export function snapshotAfter(ws: WorkspaceSnapshot, ops: readonly EditOp[]): After {
	const files = new Map(ws.files);
	const changes = new Map<string, ChangeSet>();
	const byFile = new Map<string, EditOp[]>();
	for (const op of ops) byFile.set(op.file, [...(byFile.get(op.file) ?? []), op]);
	for (const [path, list] of byFile) {
		const file = ws.files.get(path);
		if (!file) continue;
		const sorted = [...list].sort((a, b) => a.from - b.from || a.to - b.to);
		const cs: ChangeSet = changeSetOf(sorted, file.text.length);
		changes.set(path, cs);
		files.set(path, updateFile(file, cs));
	}
	const parsedAs = (path: string, top: TjpFile['top']): TjpFile => {
		const f = files.get(path) as TjpFile;
		const g = withTop(f, top);
		if (g !== f) files.set(path, g);
		return g;
	};
	const includes = buildIncludeGraph(ws.entry, {
		lookup: pathLookup(files.keys()),
		parse: (path, top) => {
			const f = parsedAs(path, top);
			return { tree: f.tree, read: (from, to) => f.text.sliceString(from, to) };
		},
	});
	return { snap: { entry: ws.entry, version: ws.version + 1, files, includes }, changes };
}

export interface Expected {
	/** Old id → new id; null when the task is gone. */
	readonly map: (id: TaskId) => TaskId | null;
	/** A new task and its parent. */
	readonly added?: { readonly id: TaskId; readonly parent: TaskId | null };
	/**
	 * The destination: `id` must be a child of `parent` (a root for null), and the checked ones
	 * of `children` (new ids) must come in this order.
	 */
	readonly order?: {
		readonly id: TaskId;
		readonly parent: TaskId | null;
		readonly children: readonly TaskId[];
	};
	/** Old reference ranges that the edit removes on purpose. */
	readonly dropped?: (at: SourceRange) => boolean;
}

/** Whether an old id and its ancestors are declared by text or keep their hint. */
function checkable(index: SymbolIndex, kept: ReadonlySet<string>, id: TaskId | null): boolean {
	for (let x = id; x !== null;) {
		const s = index.tasks.get(x);
		if (!s) return false;
		if ((s.idSource !== 'text' || s.expandedOnly) && !kept.has(x)) return false;
		x = s.parent;
	}
	return true;
}

interface Keys {
	readonly keys: Map<string, number>;
	/** The reference ranges of each key, and its `via`. */
	readonly sites: Map<string, { via: string; at: SourceRange[] }>;
	readonly unresolved: number;
	/** References left out because an end cannot be checked. */
	readonly unchecked: number;
}

function refKeys(
	index: SymbolIndex,
	map: (id: string) => string | null,
	ok: (id: string) => boolean,
	skip: (at: SourceRange) => boolean,
): Keys {
	const keys = new Map<string, number>();
	const sites = new Map<string, { via: string; at: SourceRange[] }>();
	let unresolved = 0;
	let unchecked = 0;
	for (const r of index.references) {
		if (skip(r.at)) continue;
		if (r.target === null) {
			if (r.kind === 'task') unresolved++;
			continue;
		}
		const ownerTask = r.owner !== null && index.tasks.has(r.owner);
		if ((ownerTask && !ok(r.owner as string)) || (r.kind === 'task' && !ok(r.target))) {
			unchecked++;
			continue;
		}
		const owner = r.owner === null ? null : ownerTask ? map(r.owner) : r.owner;
		const target = r.kind === 'task' ? map(r.target) : r.target;
		if (target === null || (r.owner !== null && owner === null)) continue;
		const k = `${r.kind}|${r.via}|${owner ?? ''}|${target}`;
		keys.set(k, (keys.get(k) ?? 0) + 1);
		const site = sites.get(k) ?? { via: r.via, at: [] };
		site.at.push(r.at);
		sites.set(k, site);
	}
	return { keys, sites, unresolved, unchecked };
}

/** The edited workspace of an intent: its snapshot, change sets, carried hints and index. */
export interface Edited extends After {
	readonly index: SymbolIndex;
	/** Old ids whose engine hint survived the edit (task-hints.ts). */
	readonly kept: ReadonlySet<string>;
}

/** Applies `ops` to the context's snapshot and indexes the result with the carried hints. */
export function afterEdit(
	ctx: EditContext,
	ops: readonly EditOp[],
	map: (id: TaskId) => TaskId | null,
): Edited {
	const next = snapshotAfter(ctx.ws, ops);
	const hints = mapHints(ctx.index, ctx.ws, next.snap, next.changes, map);
	return { ...next, index: buildIndex(next.snap, hints.hints), kept: hints.kept };
}

/** `reason` at `at` unless the edited workspace matches `expected` (module comment). */
export function verifyTree(
	ctx: EditContext,
	edited: Edited,
	expected: Expected,
	reason: RefusalReason,
	at: readonly SourceRange[],
): Refused | null {
	const before = ctx.index;
	const after = edited.index;
	const ok = (id: TaskId): boolean => checkable(before, edited.kept, id);
	const fail = (): Refused => refused(reason, at);
	for (const [id, sym] of before.tasks) {
		if (!ok(id)) continue;
		const mapped = expected.map(id);
		if (mapped === null) {
			if (after.tasks.has(id)) return fail();
			continue;
		}
		const now = after.tasks.get(mapped);
		if (!now) return fail();
		const parent = sym.parent === null ? null : expected.map(sym.parent);
		const want = expected.order?.id === mapped ? expected.order.parent : parent;
		if (now.parent !== want) return fail();
	}
	if (expected.added) {
		const s = after.tasks.get(expected.added.id);
		if (!s || s.parent !== expected.added.parent) return fail();
	}
	if (expected.order) {
		const { id, parent, children } = expected.order;
		const list = parent === null ? after.taskRoots : (after.tasks.get(parent)?.children ?? []);
		const want = children.filter((c) => list.includes(c));
		const got = list.filter((c) => want.includes(c));
		if (!list.includes(id) || got.join('\n') !== want.join('\n')) return fail();
	}
	const old = refKeys(before, expected.map, ok, expected.dropped ?? (() => false));
	const now = refKeys(
		after,
		(id) => id,
		() => true,
		() => false,
	);
	if (now.unresolved > old.unresolved + old.unchecked) return fail();
	for (const [k, n] of old.keys) {
		if ((now.keys.get(k) ?? 0) >= n) continue;
		const site = old.sites.get(k);
		// A flag must be declared before it is used (rule_flag): the block landed before it.
		if (site?.via === 'flags') return refused('undeclared-flag', site.at);
		// A supplement before the declaration it names (rule_taskId reads it while parsing).
		if (site?.via === 'supplement') return refused('unfixable-reference', site.at);
		return fail();
	}
	// An `allocate` read before its resource's declaration (rule_allocationHeader), as T11c.
	const late = (i: SymbolIndex): number => i.allocations.filter((a) => !a.declaredBefore).length;
	if (late(after) > late(before)) return refused('unknown-target', at);
	return null;
}

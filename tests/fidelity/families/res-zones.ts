// SPDX-License-Identifier: GPL-2.0-or-later
// Zones for declaration blocks of a tree (7.1 addTask/addResource, deleteTask/deleteResource, moveTask/
// moveResource): where a block may be inserted as child number `index`, and the gap around a block that
// removing or cutting it may change. Written once for both trees.
import {
	lineEndOf,
	RANK,
	RES_RANK,
	rg,
	type Elem,
	type Facts,
	type Rg,
	type TaskF,
} from '../gen/facts';

/** One of the two declaration trees of a plan. */
export interface Tree {
	readonly byId: (f: Facts, id: string) => TaskF | undefined;
	readonly all: (f: Facts) => readonly TaskF[];
	/** Rank table of the statements that precede child declarations in a body. */
	readonly rank: Readonly<Record<string, number>>;
	/** A root block with no sibling goes at the end of the entry file (tasks) or before the first task. */
	readonly rootsAtEnd: boolean;
}
export const RES_TREE: Tree = {
	byId: (f, id) => f.resById.get(id),
	all: (f) => f.resTree,
	rank: RES_RANK,
	rootsAtEnd: false,
};
export const TASK_TREE: Tree = {
	byId: (f, id) => f.byId.get(id),
	all: (f) => f.tasks,
	rank: RANK,
	rootsAtEnd: true,
};

const breakAfter = (t: string, p: number): number =>
	t[p] === '\r' && t[p + 1] === '\n' ? 2 : t[p] === '\n' || t[p] === '\r' ? 1 : 0;

export const siblingsIn = (tree: Tree, f: Facts, parent: TaskF | null): TaskF[] =>
	parent
		? parent.children.map((id) => tree.byId(f, id)).filter((r): r is TaskF => r !== undefined)
		: tree.all(f).filter((r) => r.parent === null);

/** The element list a block is in: its parent's body when it sits there, else its file's top level. */
function listOf(
	f: Facts,
	block: TaskF,
	parent: TaskF | null,
): { elems: readonly Elem[]; end: number; file: string; open: number } {
	const b = parent?.body;
	if (b && b.file === block.block.file && b.elems.some((e) => e.from === block.block.from)) {
		return { elems: b.elems, end: b.close, file: b.file, open: b.open };
	}
	const file = block.block.file;
	return { elems: f.topElems[file] ?? [], end: (f.texts[file] ?? '').length, file, open: 0 };
}

/** From the end of the previous element to the start of the next one: the block and its surroundings. */
export function gapZoneIn(tree: Tree, f: Facts, r: TaskF): Rg {
	const parent = r.parent === null ? null : (tree.byId(f, r.parent) ?? null);
	const { elems, end, file, open } = listOf(f, r, parent);
	const i = elems.findIndex((e) => e.from === r.block.from);
	const prev = i > 0 ? elems[i - 1] : undefined;
	const next = i >= 0 ? elems[i + 1] : undefined;
	return rg(file, prev ? prev.to : open, next ? next.start : end);
}

/** Where a block may be inserted as child number `index` of `parentId` (null: a root). */
export function slotZoneIn(
	tree: Tree,
	f: Facts,
	parentId: string | null,
	index: number,
	exclude?: string,
): Rg[] {
	const parent = parentId === null ? null : (tree.byId(f, parentId) ?? null);
	const sib = siblingsIn(tree, f, parent).filter((x) => x.id !== exclude);
	const text = (file: string): string => f.texts[file] ?? '';
	if (sib.length === 0) {
		if (parent && !parent.body) {
			const file = parent.block.file;
			const e = lineEndOf(text(file), parent.block.to);
			return [rg(file, parent.block.to, e + breakAfter(text(file), e))];
		}
		if (parent?.body) {
			// Children follow the ranked statements; statements the order skips may come after them.
			const ranked = parent.body.elems.filter(
				(e) => e.kind === 'stmt' && e.key !== null && tree.rank[e.key] !== undefined,
			);
			const last = ranked[ranked.length - 1];
			return [rg(parent.body.file, last ? last.to : parent.body.open, parent.body.close)];
		}
		const file = f.entry;
		const tops = f.topElems[file] ?? [];
		if (tree.rootsAtEnd) {
			const last = tops[tops.length - 1];
			return [rg(file, last ? last.to : 0, text(file).length)];
		}
		const firstTask = f.tasks.reduce<TaskF | null>(
			(a, t) => (a === null || t.seq < a.seq ? t : a),
			null,
		);
		const before = tops.filter((e) => !firstTask || e.to <= firstTask.start);
		const prev = before[before.length - 1];
		return [rg(file, prev ? prev.to : 0, firstTask ? firstTask.start : text(file).length)];
	}
	const at = Math.min(Math.max(index, 0), sib.length);
	const before = at > 0 ? sib[at - 1] : undefined;
	const after = at < sib.length ? sib[at] : undefined;
	const anchor = (before ?? after) as TaskF;
	const { elems, end, file, open } = listOf(f, anchor, parent);
	if (before && after) {
		const same = after.block.file === before.block.file;
		return [
			rg(before.block.file, before.block.to, same ? after.start : listOf(f, before, parent).end),
		];
	}
	if (after) {
		const i = elems.findIndex((e) => e.from === after.block.from);
		const prev = i > 0 ? elems[i - 1] : undefined;
		return [rg(file, prev ? prev.to : open, after.start)];
	}
	const b = before as TaskF;
	const i = elems.findIndex((e) => e.from === b.block.from);
	const next = i >= 0 ? elems[i + 1] : undefined;
	return [rg(file, b.block.to, next ? next.start : end)];
}

export const siblings = (f: Facts, parent: TaskF | null): TaskF[] =>
	siblingsIn(RES_TREE, f, parent);
export const gapZone = (f: Facts, r: TaskF): Rg => gapZoneIn(RES_TREE, f, r);
export const slotZone = (
	f: Facts,
	parentId: string | null,
	index: number,
	exclude?: string,
): Rg[] => slotZoneIn(RES_TREE, f, parentId, index, exclude);

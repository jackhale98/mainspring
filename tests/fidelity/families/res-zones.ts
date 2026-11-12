// SPDX-License-Identifier: GPL-2.0-or-later
// Zones for resource blocks (7.1 addResource, deleteResource, moveResource): where a resource
// declaration may be inserted, and the gap around a block that removing or cutting it may change.
import {
	firstTask,
	lineEndOf,
	RES_RANK,
	rg,
	type Elem,
	type Facts,
	type Rg,
	type TaskF,
} from '../gen/facts';

const breakAfter = (t: string, p: number): number =>
	t[p] === '\r' && t[p + 1] === '\n' ? 2 : t[p] === '\n' || t[p] === '\r' ? 1 : 0;

export const siblings = (f: Facts, parent: TaskF | null): TaskF[] =>
	parent
		? parent.children.map((id) => f.resById.get(id)).filter((r): r is TaskF => r !== undefined)
		: f.resTree.filter((r) => r.parent === null);

/** The elements of the list a resource is declared in: the parent's body, or the file's top level. */
function listOf(
	f: Facts,
	parent: TaskF | null,
	file: string,
): { elems: readonly Elem[]; end: number; file: string } {
	if (parent?.body)
		return { elems: parent.body.elems, end: parent.body.close, file: parent.body.file };
	return { elems: f.topElems[file] ?? [], end: (f.texts[file] ?? '').length, file };
}

/** From the end of the previous element to the start of the next one: the block and its surroundings. */
export function gapZone(f: Facts, r: TaskF): Rg {
	const parent = r.parent === null ? null : (f.resById.get(r.parent) ?? null);
	const { elems, end, file } = listOf(f, parent, r.block.file);
	const i = elems.findIndex((e) => e.from === r.block.from);
	const prev = i > 0 ? elems[i - 1] : undefined;
	const next = i >= 0 ? elems[i + 1] : undefined;
	const open = parent?.body ? parent.body.open : 0;
	return rg(file, prev ? prev.to : open, next ? next.start : end);
}

/** Where a resource may be inserted as child number `index` of `parentId` (null: a root). */
export function slotZone(f: Facts, parentId: string | null, index: number, exclude?: string): Rg[] {
	const parent = parentId === null ? null : (f.resById.get(parentId) ?? null);
	const sib = siblings(f, parent).filter((x) => x.id !== exclude);
	const text = (file: string): string => f.texts[file] ?? '';
	if (sib.length === 0) {
		if (parent && !parent.body) {
			const file = parent.block.file;
			const e = lineEndOf(text(file), parent.block.to);
			return [rg(file, parent.block.to, e + breakAfter(text(file), e))];
		}
		if (parent?.body) {
			// Child resources follow the ranked statements; statements the order skips (opaque ones,
			// such as `limits`) may come after them.
			const ranked = parent.body.elems.filter(
				(e) => e.kind === 'stmt' && e.key !== null && RES_RANK[e.key] !== undefined,
			);
			const last = ranked[ranked.length - 1];
			return [rg(parent.body.file, last ? last.to : parent.body.open, parent.body.close)];
		}
		const first = firstTask(f);
		const file = first?.block.file ?? f.entry;
		const tops = (f.topElems[file] ?? []).filter((e) => !first || e.to <= first.start);
		const prev = tops[tops.length - 1];
		return [rg(file, prev ? prev.to : 0, first ? first.start : text(file).length)];
	}
	const at = Math.min(Math.max(index, 0), sib.length);
	const before = at > 0 ? sib[at - 1] : undefined;
	const after = at < sib.length ? sib[at] : undefined;
	const file = (before ?? after)?.block.file ?? f.entry;
	const { elems, end } = listOf(f, parent, file);
	const open = parent?.body ? parent.body.open : 0;
	if (before && after) return [rg(file, before.block.to, after.start)];
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

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Task tree intent handlers (phase-1.md 7.1 `addTask`, `deleteTask`, `moveTask`; 7.2; 15.10,
 * 15.16).
 *
 * - `addTask(parent, index, id?, name, attrs?)` inserts `task <id> "<name>"` at sibling position
 *   `index` (task-place.ts); attributes go through `setAttr` (task-add-attrs.ts). The id is checked (`invalid-value` unless an id; `id-collision` when the
 *   parent already has a child with it, or an unresolved declaration there has it), else made
 *   from the name (`slugId`); `needs-schedule` when a child there has an id only the engine
 *   knows. The name must be safe text (`unsafe-text`). `conflicting-attribute` under a leaf with
 *   its own sizing or `milestone`, or for `effort` without an allocation (task-semantics.ts).
 * - `deleteTask(task)` removes the block with its attached leading comments, the supplement
 *   blocks of its subtree, and the `depends`/`precedes` items naming the subtree elsewhere
 *   (task-refs.ts); mentions it cannot fix refuse (`unfixable-reference`).
 * - `moveTask(task, parent, index)` cuts the block (with its leading comments) and inserts it at
 *   sibling position `index` among the new parent's other children, re-indented for the
 *   destination (task-text.ts), possibly in another file (with that file's breaks and unit). It
 *   rewrites every reference whose meaning changes (task-refs.ts). Refusals: `cycle` (into its own
 *   subtree, a dependency that would join a task and its ancestor, or a new dependency loop),
 *   `conflicting-attribute` (a leaf parent with sizing, a lost allocation), `id-collision`,
 *   `needs-schedule` (a sibling there has an id only the engine knows), `unfixable-reference`,
 *   `text-only` (a called macro defined only later, task-order.ts), noop `already-set` at the
 *   same place.
 *
 * Every intent ends with the re-index check of task-verify.ts (engine hints carried through the
 * edit, task-hints.ts), which also names late flags and resources. All three are structural, so none
 * is `sameInEveryVisit`: in a file read in several include visits they are refused with
 * `shared-declaration` (15.16).
 */
import type { TjpFile } from '../document';
import type { SourceRange, TaskSymbol } from '../index';
import { printString, slugId } from '../values';
import type { IntentHandler } from './apply';
import {
	fileText,
	isBlankChar,
	replaceSpan,
	removeListItems,
	removeStatements,
	trailingEnd,
	type Removal,
} from './layout';
import { withAttrs } from './task-add-attrs';
import { checkMovedText } from './task-order';
import { destination, insertBlock, siblingsAt } from './task-place';
import { checkAncestry, deleteFixes, idMap, moveRewrites } from './task-refs';
import { movedText } from './task-text';
import { checkEdited, checkNewParent } from './task-semantics';
import { afterEdit, verifyTree } from './task-verify';
import { checkOps, checkSafeText } from './refuse';
import { dependenciesNaming, subtree } from './refs';
import {
	isRefused,
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type TaskId,
} from './types';

const ID = /^[A-Za-z_]\w*$/;

function taskOf(ctx: EditContext, id: TaskId): TaskSymbol | null {
	return ctx.index.tasks.get(id) ?? null;
}

/** Whether a child `local` of `parent` exists, or an unresolved declaration there has that id. */
function taken(ctx: EditContext, parent: TaskId | null, local: string, except?: TaskId): boolean {
	const full = parent === null ? local : `${parent}.${local}`;
	if (full !== except && ctx.index.tasks.has(full)) return true;
	return ctx.index.unresolved.some(
		(u) => u.kind === 'task' && u.parent === parent && u.localId === local,
	);
}

/**
 * `needs-schedule` when `parent` has a child whose id only the engine knows (a macro or automatic
 * id without engine hints): a new id there could collide with it.
 */
function unknownSibling(ctx: EditContext, parent: TaskId | null): IntentPlan | null {
	const u = ctx.index.unresolved.find(
		(x) => x.kind === 'task' && x.parent === parent && x.localId === null,
	);
	return u ? refused('needs-schedule', [u.decl.header]) : null;
}

const same = (id: TaskId): TaskId => id;

/** The end of the comments after `pos` on its line (a `} # done` stays with its block), else `pos`. */
function commentsAfter(file: TjpFile, pos: number): number {
	const text = fileText(file);
	const end = trailingEnd(file, pos);
	if (end === null) return pos;
	let e = end;
	while (e > pos && isBlankChar(text[e - 1])) e--;
	return e;
}

const blockStart = (s: TaskSymbol): number =>
	Math.min(s.decl.leadingComments?.from ?? s.decl.block.from, s.decl.block.from);

// --- addTask ---------------------------------------------------------------------------------

function planAdd(ctx: EditContext, intent: IntentOf<'addTask'>): IntentPlan {
	const parent = intent.parent === null ? null : taskOf(ctx, intent.parent);
	if (intent.parent !== null && !parent) return refused('unknown-target');
	const at = parent ? [parent.decl.header] : [];
	const unsafe = checkSafeText(intent.name, at);
	if (unsafe) return unsafe;
	const name = printString(intent.name);
	if (!name.ok) return refused('unsafe-text', at);
	const pid = parent?.id ?? null;
	const unknown = unknownSibling(ctx, pid);
	if (unknown) return unknown;
	let id = intent.id;
	if (id !== undefined) {
		if (!ID.test(id)) return refused('invalid-value', at);
		if (taken(ctx, pid, id)) return refused('id-collision', at);
	} else id = slugId(intent.name, (x) => taken(ctx, pid, x));
	const siblings = siblingsAt(ctx, parent, null);
	const dest = destination(ctx, parent, siblings, intent.index);
	if (isRefused(dest)) return dest;
	const leaf = checkNewParent(ctx, parent);
	if (leaf) return leaf;
	const header = `task ${id} ${name.value}`;
	const bare = insertBlock(dest, header, { from: 0, to: header.length });
	if (isRefused(bare)) return bare;
	const point = bare.map((o) => ({ file: o.file, from: o.from, to: o.from }));
	const early = checkOps(ctx, bare);
	if (early) return early;
	const full = pid === null ? id : `${pid}.${id}`;
	const composed = withAttrs(ctx, bare, full, intent.attrs ?? [], point);
	if (isRefused(composed)) return composed;
	const ops = composed.map((op) => {
		const i = op.insert.indexOf(header);
		return i < 0 ? op : { ...op, select: { from: i, to: i + header.length } };
	});
	const children = [...siblings.map((s) => s.id)];
	children.splice(intent.index, 0, full);
	const edited = afterEdit(ctx, ops, same);
	const expected = {
		map: same,
		added: { id: full, parent: pid },
		order: { id: full, parent: pid, children },
	};
	return (
		checkOps(ctx, ops) ??
		verifyTree(ctx, edited, expected, 'unsupported-form', point) ??
		checkEdited(ctx, edited, { added: full, map: same, at: point }) ??
		ops
	);
}

// --- deleteTask ------------------------------------------------------------------------------

function planDelete(ctx: EditContext, intent: IntentOf<'deleteTask'>): IntentPlan {
	const sym = taskOf(ctx, intent.task);
	if (!sym) return refused('unknown-target');
	if (sym.expandedOnly)
		return refused('text-only', [sym.decl.block], { textOnly: 'expanded-only' });
	const ids = subtree(ctx.index, 'task', sym.id);
	const removals: Array<Removal & { file: string }> = [];
	const ranges: SourceRange[] = [];
	const add = (decl: TaskSymbol['decl']): void => {
		const block = decl.block;
		if (ranges.some((r) => r.file === block.file && r.from <= block.from && block.to <= r.to))
			return;
		const from = Math.min(decl.leadingComments?.from ?? block.from, block.from);
		ranges.push({ file: block.file, from, to: block.to });
		removals.push({ file: block.file, stmt: block, leading: decl.leadingComments });
	};
	add(sym.decl);
	for (const id of ids) for (const s of taskOf(ctx, id)?.supplements ?? []) add(s);
	const fixes = deleteFixes(ctx.index, ids, ranges);
	if (isRefused(fixes)) return fixes;
	const ops: EditOp[] = [];
	for (const f of fixes) {
		const file = ctx.ws.files.get(f.statement.file);
		if (!file) return refused('unknown-target', [f.statement]);
		const items = removeListItems(file, f.items, f.remove);
		if (items) ops.push(...items);
		else removals.push({ file: f.statement.file, stmt: f.statement, leading: null });
	}
	const byFile = new Map<string, Removal[]>();
	for (const r of removals) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
	for (const [path, list] of byFile) {
		const file = ctx.ws.files.get(path);
		if (!file) return refused('unknown-target');
		ops.push(...removeStatements(file, list));
	}
	const gone = new Set(ids);
	const map = (x: TaskId): TaskId | null => (gone.has(x) ? null : x);
	const removed = (at: SourceRange): boolean =>
		ranges.some((r) => r.file === at.file && r.from <= at.from && at.to <= r.to) ||
		ops.some((o) => o.file === at.file && o.from <= at.from && at.to <= o.to);
	const bad = overlap(ops) ?? checkOps(ctx, ops);
	if (bad) return bad;
	const edited = afterEdit(ctx, ops, map);
	const at = [sym.decl.block];
	// The old parent may become a leaf; a dependency owner may lose its only dependency.
	const owners = dependenciesNaming(ctx.index, ids).map((d) =>
		d.form === 'depends' ? d.succ : d.pred,
	);
	// An owner's dependencies are inherited by every task below it, so its leaves are checked too.
	const below = owners.flatMap((o) => (o === null ? [] : subtree(ctx.index, 'task', o)));
	const touched = [...new Set([sym.parent, ...below])].filter(
		(x): x is TaskId => x !== null && !gone.has(x),
	);
	return (
		verifyTree(ctx, edited, { map, dropped: removed }, 'unfixable-reference', at) ??
		checkEdited(ctx, edited, { touched, map, at }) ??
		ops
	);
}

/** `unsupported-form` when two ops of one file overlap (the layout cannot express the edit). */
function overlap(ops: readonly EditOp[]): IntentPlan | null {
	const sorted = [...ops].sort((a, b) =>
		a.file < b.file ? -1 : a.file > b.file ? 1 : a.from - b.from,
	);
	for (let i = 1; i < sorted.length; i++) {
		const a = sorted[i - 1] as EditOp;
		const b = sorted[i] as EditOp;
		if (a.file === b.file && a.to > b.from) {
			return refused('unsupported-form', [{ file: b.file, from: b.from, to: b.to }]);
		}
	}
	return null;
}

// --- moveTask --------------------------------------------------------------------------------

function planMove(ctx: EditContext, intent: IntentOf<'moveTask'>): IntentPlan {
	const sym = taskOf(ctx, intent.task);
	if (!sym) return refused('unknown-target');
	if (sym.expandedOnly)
		return refused('text-only', [sym.decl.block], { textOnly: 'expanded-only' });
	const parent = intent.parent === null ? null : taskOf(ctx, intent.parent);
	if (intent.parent !== null && !parent) return refused('unknown-target');
	const ids = subtree(ctx.index, 'task', sym.id);
	if (parent && ids.includes(parent.id)) return refused('cycle', [parent.decl.header]);
	const pid = parent?.id ?? null;
	const siblings = siblingsAt(ctx, parent, sym.id);
	if (pid === sym.parent) {
		const now = (pid === null ? ctx.index.taskRoots : (parent?.children ?? [])).indexOf(sym.id);
		if (now === intent.index) return noop('already-set');
	}
	const next = pid === null ? sym.localId : `${pid}.${sym.localId}`;
	if (next !== sym.id && pid !== sym.parent) {
		const unknown = unknownSibling(ctx, pid);
		if (unknown) return unknown;
	}
	if (next !== sym.id && taken(ctx, pid, sym.localId, sym.id)) {
		return refused('id-collision', parent ? [parent.decl.header] : []);
	}
	const dest = destination(ctx, parent, siblings, intent.index);
	if (isRefused(dest)) return dest;
	const src = ctx.ws.files.get(sym.decl.block.file);
	if (!src) return refused('unknown-target');
	const start = blockStart(sym);
	const end = commentsAfter(src, sym.decl.block.to);
	const moved: SourceRange = { file: src.path, from: start, to: end };
	const ancestry = next === sym.id ? null : checkAncestry(ctx.index, idMap(sym.id, next));
	if (ancestry) return ancestry;
	const leaf = pid === sym.parent ? null : checkNewParent(ctx, parent);
	if (leaf) return leaf;
	const rw = moveRewrites(ctx.index, sym.id, next, ids, moved);
	if (isRefused(rw)) return rw;
	const probe = insertBlock(dest, '', { from: 0, to: 0 });
	if (isRefused(probe)) return probe;
	const point = probe.find((o) => o.select) ?? probe[0];
	const order = checkMovedText(
		ctx.index,
		src,
		start,
		sym.decl.block.to,
		{ file: dest.file.path, pos: point?.from ?? 0 },
		next !== sym.id,
	);
	if (order) return order;
	const mt = movedText(src, sym.decl.block, start, dest, rw.inner, end);
	const header = Math.max(0, sym.decl.header.to - sym.decl.block.from);
	const ins = insertBlock(dest, mt.text, { from: mt.blockAt, to: mt.blockAt + header });
	if (isRefused(ins)) return ins;
	const block = { from: sym.decl.block.from, to: end };
	const cut = removeStatements(src, [{ stmt: block, leading: sym.decl.leadingComments }]);
	const ops: EditOp[] = [...cut, ...ins];
	for (const w of rw.outer) {
		const f = ctx.ws.files.get(w.at.file);
		if (!f) return refused('unknown-target', [w.at]);
		ops.push(replaceSpan(f, w.at, w.insert));
	}
	const map = idMap(sym.id, next);
	const children = siblings.map((s) => map(s.id));
	children.splice(intent.index, 0, next);
	const bad = overlap(ops) ?? checkOps(ctx, ops);
	if (bad) return bad;
	const edited = afterEdit(ctx, ops, map);
	const at = [sym.decl.block];
	return (
		verifyTree(
			ctx,
			edited,
			{ map, order: { id: next, parent: pid, children } },
			'unfixable-reference',
			at,
		) ??
		checkEdited(ctx, edited, { moved: ids, touched: sym.parent ? [sym.parent] : [], map, at }) ??
		ops
	);
}

// --- Registration and wrappers ---------------------------------------------------------------

export const TASK_TREE_HANDLERS: {
	readonly addTask: IntentHandler<'addTask'>;
	readonly deleteTask: IntentHandler<'deleteTask'>;
	readonly moveTask: IntentHandler<'moveTask'>;
} = {
	addTask: { plan: planAdd, sameInEveryVisit: false },
	deleteTask: { plan: planDelete, sameInEveryVisit: false },
	moveTask: { plan: planMove, sameInEveryVisit: false },
};

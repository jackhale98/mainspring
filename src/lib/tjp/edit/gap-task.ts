// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `gapToTask` (phase-3.md 6.5, section 12 H5 "Convert gap to task"): `task` depends on `target`
 * with a gap; the gap becomes a waiting task. One edit:
 *
 * - a new task is inserted just before `task` among its siblings, through `addTask`'s planner
 *   (task-tree-plan.ts: id from the name or `id`, its checks and its re-index, the 7.2 layout);
 * - it lasts the gap: `gaplength 5d` gives `length 5d`, `gapduration 2w` gives `duration 2w`,
 *   printed canonically (the value is checked as the gap, and `length` and `duration` read the
 *   same durations), and it gets `depends <target>` (`!id` for a sibling, else the absolute id,
 *   refs.ts `taskRefText`), both in a new body in the 7.2 order;
 * - `task`'s item is pointed at it (`!wait`) and its gap goes, with the `{ … }` body when nothing
 *   else is left in it (deps-gap.ts `itemOps`); the rest of the list is untouched.
 *
 * So `depends !design { gaplength 5d }` becomes `depends !wait` after
 * `task wait "Wait" { length 5d depends !design }`: the successor still starts when the gap has
 * elapsed after the target's end, in the same working (length) or calendar (duration) time.
 *
 * Refusals:
 * - `unknown-target`, `text-only` (a task declared only through macro expansion, or the item
 *   written with a macro), `macro-in-body` (deps-links.ts `linkTasks`);
 * - `inherited` when the link comes from a parent's list (the gap is the parent's);
 * - `unsupported-form` for an item with `onstart` or `onend`, for an item with both gaps or two
 *   of one kind, and when the link is not exactly one unprefixed `depends` item of `task`
 *   (a `precedes` item on the target, a scenario-prefixed item, or several items);
 * - `invalid-value` for a gap TaskJuggler would reject;
 * - `conflicting-attribute` when the new task would inherit an allocation from the parent: a
 *   waiting task must not book people;
 * - `addTask`'s refusals for the new task (`id-collision`, `invalid-value` for an id, `unsafe-text`
 *   for the name, `needs-schedule` for a sibling whose id only the engine knows);
 * - `shared-declaration` in a file read in several include visits (structural, like `addTask`).
 *
 * Noop `not-present` when the item has no gap.
 */
import type { ChangeSet } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import { changeSetOf, type TjpFile } from '../document';
import type { SourceRange } from '../index';
import { statementAt, statementsIn } from '../tree';
import { printValue } from '../values';
import type { IntentHandler } from './apply';
import { itemNode, taskState } from './dep-graph';
import { itemOps } from './deps-gap';
import {
	inheritedItems,
	inheritedLink,
	isAncestor,
	linkItems,
	linkTasks,
	unprefixed,
} from './deps-links';
import { insertStatement, replaceSpan } from './layout';
import { taskRefText } from './refs';
import { validValue } from './refuse';
import { siblingsAt } from './task-place';
import { TASK_TREE_HANDLERS } from './task-tree-plan';
import { snapshotAfter } from './task-verify';
import {
	isNoop,
	isRefused,
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type TaskAttr,
} from './types';

const GAP: Readonly<Record<string, { gap: 'gaplength' | 'gapduration'; attr: TaskAttr }>> = {
	GaplengthStatement: { gap: 'gaplength', attr: 'length' },
	GapdurationStatement: { gap: 'gapduration', attr: 'duration' },
};
const ANCHORS = new Set(['OnstartStatement', 'OnendStatement']);

/** The value text of a gap statement (after its keyword). */
function valueOf(file: TjpFile, stmt: SyntaxNode): string {
	const head = stmt.getChild('Keyword');
	const from = head?.nextSibling?.from ?? stmt.to;
	return file.text.sliceString(from, stmt.to).trim();
}

export function planGapToTask(ctx: EditContext, intent: IntentOf<'gapToTask'>): IntentPlan {
	const { index, ws } = ctx;
	const tasks = linkTasks(ctx, intent.task, intent.target);
	if ('status' in tasks) return tasks;
	const { succ, pred } = tasks;
	const all = linkItems(index, succ.id, pred.id);
	if (all.length === 0) {
		if (inheritedLink(ctx, succ.id, pred.id))
			return refused('inherited', inheritedItems(index, succ.id, pred.id));
		return refused('unknown-target', [succ.decl.header, pred.decl.header]);
	}
	const d = all[0];
	// T8: the spec speaks of "task's item"; a link made by a `precedes` item, by a
	// scenario-prefixed item or by several items has no single item to point at the new task.
	if (!d || all.length > 1 || d.form !== 'depends' || !unprefixed(index, d.scenario)) {
		return refused(
			'unsupported-form',
			all.map((x) => x.item),
		);
	}
	if (d.textOnly) return refused('text-only', [d.item], { textOnly: d.textOnly.reason });
	const file = ws.files.get(d.item.file);
	const node = itemNode(ws, d.item.file, d.item);
	if (!file || !node) return refused('unknown-target', [d.item]);
	const body = node.getChild('Body');
	const stmts = body ? statementsIn(body) : [];
	if (stmts.some((s) => ANCHORS.has(s.name))) return refused('unsupported-form', [d.item]);
	const gaps = stmts.filter((s) => GAP[s.name] !== undefined);
	if (gaps.length === 0) return noop('not-present');
	// T8: two gap statements of one kind (TaskJuggler keeps the last) are refused as both kinds
	// are: the item says more than one wait.
	const gap = gaps.length === 1 ? gaps[0] : undefined;
	const kind = gap ? GAP[gap.name] : undefined;
	if (!gap || !kind) return refused('unsupported-form', [d.item]);
	const v = validValue(ctx, kind.gap, valueOf(file, gap), d.item);
	if (isRefused(v)) return v;
	const value = printValue(v);
	if (!value.ok) return refused('invalid-value', [d.item]);
	// T8: the new task inherits the parent's `allocate` items (TaskJuggler copies them to a child
	// when it is declared), so it would book people for the gap.
	const inherited = taskState(ws, index, succ.id).inherited;
	if (inherited && inherited.allocs.length > 0) {
		const at = index.allocations
			.filter((a) => a.task !== null && isAncestor(index, a.task, succ.id))
			.map((a) => a.statement);
		return refused('conflicting-attribute', at.length > 0 ? at : [succ.decl.header]);
	}
	const parent = succ.parent === null ? null : (index.tasks.get(succ.parent) ?? null);
	const at = siblingsAt(ctx, parent, null).findIndex((s) => s.id === succ.id);
	if (at < 0) return refused('unknown-target', [succ.decl.header]);
	const add: IntentOf<'addTask'> = {
		type: 'addTask',
		parent: parent?.id ?? null,
		index: at,
		name: intent.name,
		...(intent.id === undefined ? {} : { id: intent.id }),
	};
	const added = TASK_TREE_HANDLERS.addTask.plan(ctx, add);
	if (isRefused(added) || isNoop(added)) return added;
	const sizing = { keyword: kind.attr, text: `${kind.attr} ${value.value}` };
	return fillTask(ctx, added, { ...d, node }, sizing, pred.id, succ.id, parent?.id ?? null);
}

/** The block statement whose header starts at `pos` in `file`, as a range. */
function blockAt(file: TjpFile, pos: number): SourceRange | null {
	const node = statementAt(file.tree, pos, 1);
	return node && node.from === pos ? { file: file.path, from: node.from, to: node.to } : null;
}

/** Applies `ops` (on `snap`) and composes their change sets onto `acc` (original -> result). */
function step(
	acc: Map<string, ChangeSet>,
	snap: WorkspaceSnapshot,
	ops: readonly EditOp[],
): WorkspaceSnapshot {
	const next = snapshotAfter(snap, ops);
	for (const [path, cs] of next.changes) {
		const prev = acc.get(path);
		acc.set(path, prev ? prev.compose(cs) : cs);
	}
	return next.snap;
}

/**
 * The new task's bare block (`added`, addTask's plan with its checks), its sizing statement and
 * its `depends` on `pred`, and the successor's item pointed at it with its gap removed, as ops on
 * the original text. A bare leaf has nothing a sizing could conflict with, so `setAttr`'s further
 * checks (and their re-index of the plan, twice) are not needed (T8: keeps Fedora under 50 ms).
 * The new task has no `depends` of its own yet and cannot be on a loop (only the successor will
 * depend on it), so addDepends' checks are not needed either.
 */
function fillTask(
	ctx: EditContext,
	added: readonly EditOp[],
	d: { item: SourceRange; ref: SourceRange; node: SyntaxNode },
	sizing: { keyword: string; text: string },
	pred: string,
	succ: string,
	parent: string | null,
): IntentPlan {
	const headerOp = added.find((op) => op.select);
	const sel = headerOp?.select;
	const header = headerOp && sel ? headerOp.insert.slice(sel.from, sel.to) : '';
	const local = /^task\s+([A-Za-z_]\w*)/.exec(header)?.[1];
	const odd = refused('unsupported-form', [d.item]);
	if (!headerOp || !sel || !local) return odd;
	const wait = parent === null ? local : `${parent}.${local}`;
	const file = ctx.ws.files.get(d.item.file);
	if (!file) return refused('unknown-target', [d.item]);
	const cleared = itemOps(file, d.node, null);
	if (isRefused(cleared)) return cleared;
	const repoint = replaceSpan(file, d.ref, taskRefText(succ, wait));
	const acc = new Map<string, ChangeSet>();
	const snap = step(acc, ctx.ws, [...added, repoint, ...cleared]);
	const f = snap.files.get(headerOp.file);
	const cs1 = acc.get(headerOp.file);
	const block = f && cs1 ? blockAt(f, cs1.mapPos(headerOp.from, -1) + sel.from) : null;
	if (!f || !cs1 || !block) return odd;
	// The bare block gets a body with both statements, in the 7.2 order (sizing, then `depends`),
	// each on its own line at the body's indentation (layout.ts `insertStatement`).
	const body = `${sizing.text}\ndepends ${taskRefText(wait, pred)}`;
	const filled = insertStatement(f, block, body, { scope: 'task', keyword: sizing.keyword });
	if (isRefused(filled)) return filled;
	const sorted = [...filled].sort((a, b) => a.from - b.from);
	acc.set(headerOp.file, cs1.compose(changeSetOf(sorted, f.text.length)));
	const out: EditOp[] = [];
	for (const [path, cs] of acc) {
		cs.iterChanges((from, to, _fb, _tb, inserted) => {
			const insert = inserted.toString();
			const i = path === headerOp.file ? insert.indexOf(header) : -1;
			out.push({
				file: path,
				from,
				to,
				insert,
				element: { from, to },
				...(i < 0 ? {} : { select: { from: i, to: i + header.length } }),
			});
		});
	}
	return out;
}

export const GAP_TASK_HANDLERS: { readonly gapToTask: IntentHandler<'gapToTask'> } = {
	gapToTask: { plan: planGapToTask, sameInEveryVisit: false },
};

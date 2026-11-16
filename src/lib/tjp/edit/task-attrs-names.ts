// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `renameTask` and `declareFlag` (phase-1.md 7.1, T11a), registered by task-attrs.ts.
 *
 * - `renameTask` rewrites the name string only, in its quote style (a cut-here name becomes a
 *   double-quoted one), escaping that quote; `unsafe-text` for `${`, `$(`, line breaks, or a
 *   name no quote style can hold (a trailing backslash); noop `already-set` for the same name.
 *   A templated name is text-only. With `id` (polish item 15), the same edit also rewrites the
 *   id token, when task-rename-id.ts allows it (its refusals otherwise), and the edited workspace
 *   must index to the same tree with the task under its new id (task-verify.ts). Only `id`
 *   different from the task's local id changes it; noop `already-set` when neither changes.
 * - `declareFlag` declares the flag where every task can use it (rule_flag looks flags up while
 *   it parses): it appends `, id` to the last file-level `flags` declaration read before the
 *   first task, else inserts `flags id` before the first task (after the text above it and its
 *   comments); with no task, it appends to the last declaration or inserts after the project
 *   header. Noop `already-set` when the flag is declared before the first task (or anywhere,
 *   without tasks); declaring it again is harmless natively. `invalid-value` for a flag that is
 *   not an id.
 */
import { isId, parseString, printStringPreferring } from '../values';
import { appendListItem, insertStatement, replaceSpan, statementNode } from './layout';
import { checkSafeText, checkTextOnly } from './refuse';
import { fileOf, taskOf } from './task-attrs-checks';
import { readBefore } from './task-attrs-value';
import { planIdChange } from './task-rename-id';
import { idMap } from './task-refs';
import { afterEdit, verifyTree } from './task-verify';
import {
	isRefused,
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type SourceRange,
} from './types';

export function planRenameTask(ctx: EditContext, intent: IntentOf<'renameTask'>): IntentPlan {
	const sym = taskOf(ctx, intent.task);
	if (isRefused(sym)) return sym;
	const name = sym.decl.name;
	if (!name) return refused('unsupported-form', [sym.decl.header]);
	const unsafe = checkSafeText(intent.name, [name]);
	if (unsafe) return unsafe;
	const file = fileOf(ctx, name);
	if (isRefused(file)) return file;
	const written = parseString(file.text.sliceString(name.from, name.to));
	if (!written.ok) {
		return checkTextOnly(ctx, name.file, name) ?? refused('unsupported-form', [name]);
	}
	const ops: EditOp[] = [];
	if (written.value !== intent.name) {
		const style = written.style === 'cut' ? 'double' : written.style;
		const printed = printStringPreferring(intent.name, style);
		if (!printed.ok || printed.value.startsWith('-8<-')) return refused('unsafe-text', [name]);
		ops.push(replaceSpan(file, name, printed.value));
	}
	if (intent.id === undefined || intent.id === sym.localId) {
		return ops.length > 0 ? ops : noop('already-set');
	}
	const idOp = planIdChange(ctx, sym, intent.id);
	if (isRefused(idOp)) return idOp;
	ops.push(idOp);
	const next = sym.parent === null ? intent.id : `${sym.parent}.${intent.id}`;
	const map = idMap(sym.id, next);
	return (
		verifyTree(ctx, afterEdit(ctx, ops, map), { map }, 'unfixable-reference', [sym.decl.header]) ??
		ops
	);
}

export function planDeclareFlag(ctx: EditContext, intent: IntentOf<'declareFlag'>): IntentPlan {
	const flag = intent.flag;
	const first = ctx.index.taskRoots
		.map((id) => ctx.index.tasks.get(id))
		.find((t) => t !== undefined);
	const early = (at: SourceRange): boolean => !first || readBefore(ctx, at, first.decl.block);
	const decls = ctx.index.globalFlags.filter((f) => early(f.statement));
	const last = decls[decls.length - 1];
	if (!isId(flag)) return refused('invalid-value', last ? [last.statement] : []);
	const declared = ctx.index.flags.get(flag);
	if (declared && early(declared)) return noop('already-set');
	if (last) {
		const file = fileOf(ctx, last.statement);
		if (isRefused(file)) return file;
		const node = statementNode(file, last.statement);
		const items = node ? node.getChildren('Flag').map((f) => ({ from: f.from, to: f.to })) : [];
		const op = appendListItem(file, last.statement, items, flag);
		return 'status' in op ? op : [op];
	}
	const anchor = first?.decl.block ?? ctx.index.project?.decl.block ?? null;
	const file = ctx.ws.files.get(anchor?.file ?? ctx.ws.entry);
	if (!file) return refused('unknown-target');
	const place = !anchor ? 'end' : first ? { before: anchor } : { after: anchor };
	return insertStatement(file, null, `flags ${flag}`, place, {
		select: { from: 6, to: 6 + flag.length },
	});
}

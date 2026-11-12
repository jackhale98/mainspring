// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `renameTask` and `declareFlag` (phase-1.md 7.1, T11a), registered by task-attrs.ts.
 *
 * - `renameTask` rewrites the name string only, in its quote style (a cut-here name becomes a
 *   double-quoted one), escaping that quote; `unsafe-text` for `${`, `$(`, line breaks, or a
 *   name no quote style can hold (a trailing backslash); noop `already-set` for the same name.
 *   A templated name is text-only.
 * - `declareFlag` appends `, id` to the last file-level `flags` declaration, else inserts
 *   `flags id` before the first task (after the text above it and its comments), or after the
 *   project header when there is no task; noop `already-set` when the flag is declared;
 *   `invalid-value` for a flag that is not an id.
 */
import { isId, parseString, printStringPreferring } from '../values';
import { appendListItem, insertStatement, replaceSpan, statementNode } from './layout';
import { checkSafeText, checkTextOnly } from './refuse';
import { fileOf, taskOf } from './task-attrs-checks';
import {
	isRefused,
	noop,
	refused,
	type EditContext,
	type IntentOf,
	type IntentPlan,
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
	if (written.value === intent.name) return noop('already-set');
	const style = written.style === 'cut' ? 'double' : written.style;
	const printed = printStringPreferring(intent.name, style);
	if (!printed.ok || printed.value.startsWith('-8<-')) return refused('unsafe-text', [name]);
	return [replaceSpan(file, name, printed.value)];
}

export function planDeclareFlag(ctx: EditContext, intent: IntentOf<'declareFlag'>): IntentPlan {
	const flag = intent.flag;
	const last = ctx.index.globalFlags[ctx.index.globalFlags.length - 1];
	if (!isId(flag)) return refused('invalid-value', last ? [last.statement] : []);
	if (ctx.index.flags.has(flag)) return noop('already-set');
	if (last) {
		const file = fileOf(ctx, last.statement);
		if (isRefused(file)) return file;
		const node = statementNode(file, last.statement);
		const items = node ? node.getChildren('Flag').map((f) => ({ from: f.from, to: f.to })) : [];
		const op = appendListItem(file, last.statement, items, flag);
		return 'status' in op ? op : [op];
	}
	const first = ctx.index.taskRoots
		.map((id) => ctx.index.tasks.get(id))
		.find((t) => t !== undefined);
	const anchor = first?.decl.block ?? ctx.index.project?.decl.block ?? null;
	const file = ctx.ws.files.get(anchor?.file ?? ctx.ws.entry);
	if (!file) return refused('unknown-target');
	const place = !anchor ? 'end' : first ? { before: anchor } : { after: anchor };
	return insertStatement(file, null, `flags ${flag}`, place, {
		select: { from: 6, to: 6 + flag.length },
	});
}

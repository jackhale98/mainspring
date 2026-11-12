// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `setAttr` of `flags` and `responsible` (phase-1.md 7.1, T11a; section 15, T11a entry), called
 * by task-attrs.ts. Both accumulate: every own statement (declaration and supplements) and every
 * ancestor's statement read before the task was created adds ids (rule_flags,
 * `responsible … += …; uniq!`). The value of the intent is the task's whole list:
 *
 * - an id the task inherits must stay in it (`inherited`, at the ancestor's statements);
 * - noop `already-set` when the task's own and inherited ids are already exactly the value;
 * - otherwise the task's own contribution is made equal to the value: the last own statement's
 *   list is rewritten to it and the other own statements are removed, or, with none,
 *   `attr ids` is inserted into the declaration;
 * - ids are checked as task-attrs-value.ts says; `responsible` ids are written relative to the
 *   `resourceprefix` of the file the statement is in (an id outside it cannot be written there:
 *   `invalid-value`).
 */
import type { AttrSite, TaskSymbol } from '../index';
import { replaceValue } from './layout';
import { fileOf, inheritedIds, macroWritten, ownSites, ranges, siteIds } from './task-attrs-checks';
import { checkIdList } from './task-attrs-value';
import {
	isRefused,
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type Refused,
	type SourceRange,
} from './types';

/** Inserts `text` into the declaration body (task-attrs.ts `insertAttr`). */
export type InsertAttr = (
	ctx: EditContext,
	sym: TaskSymbol,
	keyword: string,
	text: string,
) => EditOp[] | Refused;

/** Removes sites with their lines (task-attrs.ts `removeSites`). */
export type RemoveSites = (ctx: EditContext, sites: readonly AttrSite[]) => EditOp[] | Refused;

/** `responsible` ids as written in `file` (its `resourceprefix` stripped). */
function written(
	ctx: EditContext,
	attr: 'flags' | 'responsible',
	ids: readonly string[],
	at: SourceRange,
): string[] | Refused {
	if (attr === 'flags') return [...ids];
	const prefix = ctx.index.visits.find((v) => v.file === at.file)?.resourcePrefix;
	if (!prefix || prefix.kind === 'none') return [...ids];
	if (prefix.kind === 'unknown') return refused('invalid-value', [at]);
	const out: string[] = [];
	for (const id of ids) {
		if (!id.startsWith(`${prefix.id}.`)) return refused('invalid-value', [at]);
		out.push(id.slice(prefix.id.length + 1));
	}
	return out;
}

const sameSet = (a: ReadonlySet<string>, b: readonly string[]): boolean =>
	a.size === new Set(b).size && b.every((x) => a.has(x));

export function planIdList(
	ctx: EditContext,
	sym: TaskSymbol,
	attr: 'flags' | 'responsible',
	value: IntentOf<'setAttr'>['value'],
	insert: InsertAttr,
	remove: RemoveSites,
): IntentPlan {
	const own = ownSites(ctx, sym, attr);
	const macro = macroWritten(own);
	if (macro) return macro;
	const last = own[own.length - 1];
	const at = [last?.value ?? sym.decl.header];
	const ids = checkIdList(ctx, attr, value, last?.statement ?? sym.decl.block, at);
	if (isRefused(ids)) return ids;
	const up = inheritedIds(ctx, sym, attr);
	const lost = [...up].filter(([id]) => !ids.includes(id)).flatMap(([, sites]) => sites);
	if (lost.length > 0) return refused('inherited', ranges([...new Set(lost)]));
	const now = new Set([...own.flatMap((s) => siteIds(ctx, s)), ...up.keys()]);
	if (sameSet(now, ids)) return noop('already-set');
	if (!last) {
		const text = written(ctx, attr, ids, sym.decl.block);
		return isRefused(text) ? text : insert(ctx, sym, attr, `${attr} ${text.join(', ')}`);
	}
	if (!last.value) return refused('unsupported-form', at);
	const file = fileOf(ctx, last.statement);
	if (isRefused(file)) return file;
	const text = written(ctx, attr, ids, last.statement);
	if (isRefused(text)) return text;
	const op = replaceValue(file, last.value, { kind: 'idList', value: text });
	if (isRefused(op)) return op;
	const others = remove(ctx, own.slice(0, -1));
	if (isRefused(others)) return others;
	const ops = 'status' in op ? others : [op, ...others];
	return ops.length > 0 ? ops : noop('already-set');
}

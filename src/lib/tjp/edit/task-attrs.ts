// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Task attribute intents (phase-1.md 7.1, T11a): `setAttr` and `removeAttr` here, `renameTask`
 * and `declareFlag` in task-attrs-names.ts, all registered as `TASK_ATTR_HANDLERS` in apply.ts
 * `HANDLERS`. Values are checked in task-attrs-value.ts, combinations TaskJuggler rejects in
 * task-attrs-checks.ts; the plan's function names are in task-attrs-api.ts.
 *
 * Sites. A task's own sites are its `attrs` (declaration and supplement bodies, in reading
 * order). An unprefixed site and one prefixed with the top scenario (`plan:effort`) are the same
 * (`lastSite`); sites of other scenarios are never edited.
 *
 * - `setAttr` rewrites the value of the last own site, keeping the written spelling when it
 *   already means the new value (noop `already-set`), else inserts `attr value` into the
 *   declaration body by the 7.2 order. A body with statement-level macro calls is refused
 *   (`macro-in-body`): the call may set the attribute later, so the last site is not known.
 * - Sizing (`effort`, `length`, `duration`): TaskJuggler rejects a second sizing criterion of a
 *   task, even in a supplement (`multiple_durations`), so the last own sizing statement is
 *   rewritten, its keyword with it when it differs, and the task's other own sizing statements
 *   are removed; a statement is inserted only when there is none. `conflicting-attribute` for a
 *   milestone, a container, or a task the criterion would overspecify.
 * - `milestone`: `true` inserts `milestone` (`conflicting-attribute` with a sizing statement, a
 *   child, or a start and end that differ; noop when present), `false` removes every own site
 *   (noop `not-present`).
 * - `start`, `end`: `conflicting-attribute` when they would overspecify the task, or differ on a
 *   milestone. `scheduling alap`: `conflicting-attribute` for a task with bookings, or one it
 *   would overspecify.
 * - `flags`, `responsible`: the id list of the last own site is rewritten, else inserted; ids
 *   checked as task-attrs-value.ts says (`undeclared-flag`, `invalid-value`).
 * - `removeAttr` removes every own site with its line (a trailing comment stays). With none, it
 *   is `inherited` when an ancestor sets an attribute TaskJuggler inherits (Project.rb task
 *   attributes: flags, scheduling, maxend, minstart, priority, responsible), `macro-in-body`
 *   when a statement-level macro call could set it, else noop `not-present`.
 *
 * Shared files (15.16): value rewrites and inserts of value attributes, `milestone` and the name
 * string mean the same in every include visit (`sameInEveryVisit`); the id-valued `flags` and
 * `responsible`, and `declareFlag`, do not.
 */
import type { AttrSite, SourceRange, TaskSymbol } from '../index';
import { statementHead } from '../tree';
import { printValue, type TypedValue } from '../values';
import type { IntentHandler } from './apply';
import {
	insertStatement,
	removeStatements,
	replaceSpan,
	replaceValue,
	statementNode,
	type Removal,
} from './layout';
import {
	SIZING,
	bookingsOf,
	fileOf,
	fixedBounds,
	isContainer,
	lastOwn,
	overspecifiedBy,
	ownSites,
	ranges,
	taskOf,
} from './task-attrs-checks';
import { planDeclareFlag, planRenameTask } from './task-attrs-names';
import { checkAttrValue, checkIdList, parseAttrValue } from './task-attrs-value';
import {
	isRefused,
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type Refused,
	type TaskAttr,
} from './types';

const ID_LISTS: ReadonlySet<string> = new Set(['flags', 'responsible']);
/** Task attributes TaskJuggler inherits from the parent task (Project.rb, `Inh.` column). */
const INHERITED: ReadonlySet<string> = new Set([
	'flags',
	'scheduling',
	'maxend',
	'minstart',
	'priority',
	'responsible',
]);

const macroInBody = (sym: TaskSymbol): Refused | null =>
	sym.bodyMacroCalls.length > 0 ? refused('macro-in-body', sym.bodyMacroCalls) : null;

const conflict = (sym: TaskSymbol, at: readonly SourceRange[] | null): Refused | null =>
	at ? refused('conflicting-attribute', at.length > 0 ? at : [sym.decl.header]) : null;

/** Inserts `text` (keyword first) into the declaration body by the 7.2 order. */
function insertAttr(
	ctx: EditContext,
	sym: TaskSymbol,
	keyword: string,
	text: string,
): EditOp[] | Refused {
	const file = fileOf(ctx, sym.decl.block);
	if (isRefused(file)) return file;
	const select = { from: text === keyword ? 0 : keyword.length + 1, to: text.length };
	return insertStatement(file, sym.decl.block, text, { scope: 'task', keyword }, { select });
}

/** Removes sites with their lines, file by file. */
function removeSites(ctx: EditContext, sites: readonly AttrSite[]): EditOp[] | Refused {
	const byFile = new Map<string, Removal[]>();
	for (const s of sites) {
		const list = byFile.get(s.statement.file) ?? [];
		list.push({ stmt: s.statement });
		byFile.set(s.statement.file, list);
	}
	const out: EditOp[] = [];
	for (const [path, list] of byFile) {
		const file = ctx.ws.files.get(path);
		if (!file) return refused('unknown-target');
		out.push(...removeStatements(file, list));
	}
	return out;
}

/** The canonical text of a value, or null when it has none. */
function printed(v: TypedValue): string | null {
	const p = printValue(v);
	return p.ok ? p.value : null;
}

/** Rewrites a site's value to `v`, checked at the site. */
function rewriteValue(
	ctx: EditContext,
	site: AttrSite,
	keyword: string,
	v: TypedValue,
): IntentPlan {
	const at = [site.value ?? site.statement];
	if (!site.value) return refused('unsupported-form', at);
	const file = fileOf(ctx, site.value);
	if (isRefused(file)) return file;
	const op = replaceValue(file, site.value, v);
	if ('status' in op) return op;
	return checkAttrValue(ctx, keyword, v, site.value, at) ?? [op];
}

/** Inserts `keyword value`, checked where it lands. */
function insertValue(
	ctx: EditContext,
	sym: TaskSymbol,
	keyword: string,
	v: TypedValue,
): IntentPlan {
	const at = [sym.decl.header];
	const text = printed(v);
	if (text === null) return refused('invalid-value', at);
	const ops = insertAttr(ctx, sym, keyword, `${keyword} ${text}`);
	if (isRefused(ops)) return ops;
	const last = ops[ops.length - 1];
	const pos = last ? { file: last.file, from: last.from, to: last.from } : sym.decl.block;
	return checkAttrValue(ctx, keyword, v, pos, at) ?? ops;
}

function planSizing(ctx: EditContext, sym: TaskSymbol, attr: string, v: TypedValue): IntentPlan {
	const milestones = ownSites(ctx, sym, 'milestone');
	if (milestones.length > 0) return refused('conflicting-attribute', ranges(milestones));
	if (isContainer(ctx, sym)) return refused('conflicting-attribute', [sym.decl.header]);
	const over = conflict(sym, overspecifiedBy(ctx, sym, { attr, value: v }));
	if (over) return over;
	const sizing = ownSites(ctx, sym, SIZING);
	const last = sizing[sizing.length - 1];
	if (!last) return insertValue(ctx, sym, attr, v);
	if (last.keyword === attr) return rewriteValue(ctx, last, attr, v);
	// Another criterion: rewrite the last statement's keyword and value, drop the other ones.
	const at = [last.statement];
	const file = fileOf(ctx, last.statement);
	if (isRefused(file)) return file;
	const node = statementNode(file, last.statement);
	const kw = node && statementHead(node);
	const value = printed(v);
	if (!kw || !last.value || value === null) return refused('unsupported-form', at);
	const text = `${attr} ${value}`;
	const op = replaceSpan(file, { from: kw.from, to: last.value.to }, text, {
		select: { from: attr.length + 1, to: text.length },
	});
	const others = removeSites(ctx, sizing.slice(0, -1));
	if (isRefused(others)) return others;
	return checkAttrValue(ctx, attr, v, last.value, at) ?? [op, ...others];
}

function planMilestone(ctx: EditContext, sym: TaskSymbol, value: boolean): IntentPlan {
	const own = ownSites(ctx, sym, 'milestone');
	if (!value) return own.length === 0 ? noop('not-present') : removeSites(ctx, own);
	if (own.length > 0) return noop('already-set');
	const sizing = ownSites(ctx, sym, SIZING);
	if (sizing.length > 0) return refused('conflicting-attribute', ranges(sizing));
	if (isContainer(ctx, sym)) return refused('conflicting-attribute', [sym.decl.header]);
	return conflict(sym, fixedBounds(ctx, sym)) ?? insertAttr(ctx, sym, 'milestone', 'milestone');
}

function planIdList(
	ctx: EditContext,
	sym: TaskSymbol,
	attr: 'flags' | 'responsible',
	value: IntentOf<'setAttr'>['value'],
): IntentPlan {
	const site = lastOwn(ctx, sym, attr);
	const at = [site?.value ?? sym.decl.header];
	const ids = checkIdList(ctx, attr, value, site?.statement ?? sym.decl.block, at);
	if (isRefused(ids)) return ids;
	if (!site) return insertAttr(ctx, sym, attr, `${attr} ${ids.join(', ')}`);
	const file = fileOf(ctx, site.statement);
	if (isRefused(file)) return file;
	if (!site.value) return refused('unsupported-form', at);
	const op = replaceValue(file, site.value, { kind: 'idList', value: ids });
	return 'status' in op ? op : [op];
}

/** The checks of a value attribute's new value against the rest of the task. */
function valueConflicts(
	ctx: EditContext,
	sym: TaskSymbol,
	attr: string,
	v: TypedValue,
): Refused | null {
	if (attr === 'start' || attr === 'end' || attr === 'scheduling') {
		const over = conflict(sym, overspecifiedBy(ctx, sym, { attr, value: v }));
		if (over) return over;
	}
	if ((attr === 'start' || attr === 'end') && lastOwn(ctx, sym, 'milestone')) {
		return conflict(sym, fixedBounds(ctx, sym, { keyword: attr, value: v }));
	}
	if (attr === 'scheduling' && v.kind === 'scheduling' && v.value === 'alap') {
		const bookings = bookingsOf(ctx, sym);
		if (bookings.length > 0) return refused('conflicting-attribute', bookings);
	}
	return null;
}

function planSetAttr(ctx: EditContext, intent: IntentOf<'setAttr'>): IntentPlan {
	const sym = taskOf(ctx, intent.task);
	if (isRefused(sym)) return sym;
	const { attr, value } = intent;
	if (attr === 'flags' || attr === 'responsible') return planIdList(ctx, sym, attr, value);
	const blocked = macroInBody(sym);
	if (blocked) return blocked;
	if (attr === 'milestone') {
		return typeof value === 'boolean'
			? planMilestone(ctx, sym, value)
			: refused('invalid-value', [sym.decl.header]);
	}
	const site = SIZING.has(attr) ? null : lastOwn(ctx, sym, attr);
	const v = parseAttrValue(attr, value, [site?.value ?? sym.decl.header]);
	if (isRefused(v)) return v;
	if (SIZING.has(attr)) return planSizing(ctx, sym, attr, v);
	const conflicts = valueConflicts(ctx, sym, attr, v);
	if (conflicts) return conflicts;
	return site ? rewriteValue(ctx, site, attr, v) : insertValue(ctx, sym, attr, v);
}

/** Own sites of `attr` set by the nearest ancestor that sets it, for `inherited`. */
function inheritedSites(ctx: EditContext, sym: TaskSymbol, attr: TaskAttr): AttrSite[] {
	if (!INHERITED.has(attr)) return [];
	for (let p = sym.parent; p !== null;) {
		const up = ctx.index.tasks.get(p);
		if (!up) break;
		const own = ownSites(ctx, up, attr);
		if (own.length > 0) return own;
		p = up.parent;
	}
	return [];
}

function planRemoveAttr(ctx: EditContext, intent: IntentOf<'removeAttr'>): IntentPlan {
	const sym = taskOf(ctx, intent.task);
	if (isRefused(sym)) return sym;
	const own = ownSites(ctx, sym, intent.attr);
	if (own.length > 0) return removeSites(ctx, own);
	const up = inheritedSites(ctx, sym, intent.attr);
	if (up.length > 0) return refused('inherited', ranges(up));
	return macroInBody(sym) ?? noop('not-present');
}

export const TASK_ATTR_HANDLERS: {
	readonly setAttr: IntentHandler<'setAttr'>;
	readonly removeAttr: IntentHandler<'removeAttr'>;
	readonly renameTask: IntentHandler<'renameTask'>;
	readonly declareFlag: IntentHandler<'declareFlag'>;
} = {
	setAttr: { plan: planSetAttr, sameInEveryVisit: (i) => !ID_LISTS.has(i.attr) },
	removeAttr: { plan: planRemoveAttr, sameInEveryVisit: (i) => !ID_LISTS.has(i.attr) },
	renameTask: { plan: planRenameTask, sameInEveryVisit: true },
	declareFlag: { plan: planDeclareFlag },
};

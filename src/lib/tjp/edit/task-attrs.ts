// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Task attribute intents (phase-1.md 7.1, T11a; section 15, T11a entry): `setAttr` and
 * `removeAttr` here, `flags`/`responsible` lists in task-attrs-ids.ts, `renameTask` and
 * `declareFlag` in task-attrs-names.ts, all registered as `TASK_ATTR_HANDLERS` in apply.ts
 * `HANDLERS`. Values are checked in task-attrs-value.ts, combinations TaskJuggler rejects in
 * task-attrs-checks.ts and task-attrs-timing.ts; the plan's function names are in
 * task-attrs-api.ts.
 *
 * Sites. A task's own sites are its `attrs` (declaration and supplement bodies, in reading
 * order). An unprefixed site and one prefixed with the top scenario (`plan:effort`) are the same
 * (`lastSite`); sites of other scenarios are never edited.
 *
 * - `setAttr` rewrites the value of the last own site, keeping the written spelling when it
 *   already means the new value (noop `already-set`), else inserts `attr value` into the
 *   declaration body by the 7.2 order, but before the first statement of another scenario that
 *   sets the attribute (for sizing and `milestone`: any sizing or `milestone` statement): a
 *   top-scenario value read later is copied over the other scenario's
 *   (PropertyTreeNode#[]=), and a sizing statement resets the others (setDurationAttribute).
 * - A statement-level macro call in the task's bodies refuses an edit (`macro-in-body`) unless
 *   it cannot hold the keywords the edit reads (task-attrs-checks.ts `macroInBody`, 5.4).
 * - Sizing (`effort`, `length`, `duration`): TaskJuggler rejects a second sizing criterion of a
 *   task, even in a supplement (`multiple_durations`), so the last own sizing statement is
 *   rewritten, its keyword with it when it differs, and the task's other own sizing statements
 *   are removed; a statement is inserted only when there is none. `conflicting-attribute` for a
 *   milestone or a container.
 * - `milestone`: `true` inserts `milestone` (`conflicting-attribute` with a sizing statement, a
 *   child, or a start and end that differ; noop when present), `false` removes every own site
 *   (noop `not-present`).
 * - `start`, `end` on a milestone: `conflicting-attribute` when they would differ.
 * - Every change to a timing attribute (sizing, `milestone`, `start`, `end`, `scheduling`) is
 *   `conflicting-attribute` when it breaks a timing check task-attrs-timing.ts models
 *   (`task_overspecified`, `milestone_start_end`, bookings of an ALAP task).
 * - `removeAttr` removes every own site with its line (a trailing comment stays); a site written
 *   with a macro is `text-only`. With none, it is `inherited` when an ancestor sets, before the
 *   task is created, an attribute TaskJuggler inherits (Project.rb task attributes: flags,
 *   scheduling, maxend, minstart, priority, responsible), else noop `not-present`.
 *
 * Shared files (15.16): value rewrites and inserts of value attributes, `milestone` and the name
 * string mean the same in every include visit (`sameInEveryVisit`); the id-valued `flags` and
 * `responsible`, and `declareFlag`, do not.
 */
import type { AttrSite, SourceRange, TaskSymbol } from '../index';
import { statementHead } from '../tree';
import { printValue, type TypedValue } from '../values';
import type { IntentHandler } from './apply';
import { dependentsOf, isUnderspecified } from './dep-anchors';
import { taskState } from './dep-graph';
import {
	insertStatement,
	removeStatements,
	replaceSpan,
	replaceValue,
	statementNode,
	type Removal,
} from './layout';
import {
	INHERITED,
	SIZING,
	fileOf,
	fixedBounds,
	inheritedSites,
	isContainer,
	lastOwn,
	macroInBody,
	macroWritten,
	otherScenarioSites,
	ownSites,
	ranges,
	taskOf,
} from './task-attrs-checks';
import { planIdList } from './task-attrs-ids';
import { planDeclareFlag, planRenameTask } from './task-attrs-names';
import { timingConflicts, type TimingChange } from './task-attrs-timing';
import { checkAttrValue, parseAttrValue } from './task-attrs-value';
import {
	isNoop,
	isRefused,
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type Refused,
} from './types';

const ID_LISTS: ReadonlySet<string> = new Set(['flags', 'responsible']);
const SIZE_OR_MILESTONE: ReadonlySet<string> = new Set([...SIZING, 'milestone']);
/** Attributes whose changes the timing checks read, and the keywords those checks read. */
const TIMING_ATTRS: ReadonlySet<string> = new Set([
	...SIZE_OR_MILESTONE,
	'start',
	'end',
	'scheduling',
]);
const TIMING_READS: ReadonlySet<string> = new Set([
	...TIMING_ATTRS,
	'depends',
	'precedes',
	'scheduled',
	'booking',
]);

/** The keywords a macro call must not hold for an edit of `attr`. */
const reads = (attr: string): ReadonlySet<string> =>
	TIMING_ATTRS.has(attr) ? TIMING_READS : new Set([attr]);

const conflict = (sym: TaskSymbol, at: readonly SourceRange[] | null): Refused | null =>
	at ? refused('conflicting-attribute', at.length > 0 ? at : [sym.decl.header]) : null;

const inside = (r: SourceRange, o: SourceRange): boolean =>
	r.file === o.file && o.from <= r.from && r.to <= o.to;

/** Where the last op of an insertion is read, as a point. */
function pointOf(ops: readonly EditOp[]): SourceRange | null {
	const last = ops[ops.length - 1];
	return last ? { file: last.file, from: last.from, to: last.from } : null;
}

/**
 * Inserts `text` (keyword first) into the declaration body by the 7.2 order, but before the
 * first declaration-body statement of another scenario that sets the same attribute (module
 * comment).
 */
function insertAttr(
	ctx: EditContext,
	sym: TaskSymbol,
	keyword: string,
	text: string,
): EditOp[] | Refused {
	const block = sym.decl.block;
	const file = fileOf(ctx, block);
	if (isRefused(file)) return file;
	const select = { from: text === keyword ? 0 : keyword.length + 1, to: text.length };
	const ops = insertStatement(file, block, text, { scope: 'task', keyword }, { select });
	if (isRefused(ops)) return ops;
	const guard = SIZE_OR_MILESTONE.has(keyword) ? SIZE_OR_MILESTONE : keyword;
	const first = otherScenarioSites(ctx, sym, guard).find((s) => inside(s.statement, block));
	const at = pointOf(ops);
	if (!first || !at || at.from <= first.statement.from) return ops;
	return insertStatement(file, block, text, { before: first.statement }, { select });
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
	const written = macroWritten([site]);
	if (written) return written;
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
	const pos = pointOf(ops) ?? sym.decl.block;
	return checkAttrValue(ctx, keyword, v, pos, at) ?? ops;
}

/** The plan's ops, unless the change breaks a timing check (task-attrs-timing.ts). */
function timed(
	ctx: EditContext,
	sym: TaskSymbol,
	plan: IntentPlan,
	change: (ops: readonly EditOp[]) => TimingChange,
): IntentPlan {
	if (isRefused(plan) || isNoop(plan)) return plan;
	return conflict(sym, timingConflicts(ctx, sym, change(plan))) ?? plan;
}

function planSizing(ctx: EditContext, sym: TaskSymbol, attr: string, v: TypedValue): IntentPlan {
	const milestones = ownSites(ctx, sym, 'milestone');
	if (milestones.length > 0) return refused('conflicting-attribute', ranges(milestones));
	if (isContainer(ctx, sym)) return refused('conflicting-attribute', [sym.decl.header]);
	const sizing = ownSites(ctx, sym, SIZING);
	const written = macroWritten(sizing);
	if (written) return written;
	const last = sizing[sizing.length - 1];
	const change = (ops: readonly EditOp[]): TimingChange => ({
		attr,
		value: v,
		at: last?.statement ?? pointOf(ops),
		replaces: sizing,
	});
	if (!last) return timed(ctx, sym, insertValue(ctx, sym, attr, v), change);
	if (last.keyword === attr) return timed(ctx, sym, rewriteValue(ctx, last, attr, v), change);
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
	const plan = checkAttrValue(ctx, attr, v, last.value, at) ?? [op, ...others];
	return timed(ctx, sym, plan, change);
}

/**
 * `conflicting-attribute` at `removed` when removing them leaves the leaf without any size or
 * `milestone` while an allocation or booking keeps it from becoming a milestone, and it has neither
 * a start nor an end, or only one while a dependency waits on the other (dep-graph.ts
 * `isUnderspecified`; native `task_underspecified`).
 */
function sizeLost(ctx: EditContext, sym: TaskSymbol, removed: readonly AttrSite[]): Refused | null {
	if (isContainer(ctx, sym)) return null;
	const gone = new Set(removed);
	const left = ownSites(ctx, sym, SIZE_OR_MILESTONE).filter((s) => !gone.has(s));
	if (left.length > 0) return null;
	const st = taskState(ctx.ws, ctx.index, sym.id).state;
	const after = { ...st, sizing: false, milestone: false };
	const dependents = dependentsOf(ctx.ws, ctx.index, sym.id);
	return isUnderspecified(after, dependents)
		? refused('conflicting-attribute', ranges(removed))
		: null;
}

function planMilestone(ctx: EditContext, sym: TaskSymbol, value: boolean): IntentPlan {
	const own = ownSites(ctx, sym, 'milestone');
	if (!value) {
		if (own.length === 0) return noop('not-present');
		const written = macroWritten(own);
		if (written) return written;
		const removal = { attr: 'milestone', value: null, at: null, replaces: own };
		return sizeLost(ctx, sym, own) ?? timed(ctx, sym, removeSites(ctx, own), () => removal);
	}
	if (own.length > 0) return noop('already-set');
	const sizing = ownSites(ctx, sym, SIZING);
	if (sizing.length > 0) return refused('conflicting-attribute', ranges(sizing));
	if (isContainer(ctx, sym)) return refused('conflicting-attribute', [sym.decl.header]);
	const bounds = conflict(sym, fixedBounds(ctx, sym));
	if (bounds) return bounds;
	return timed(ctx, sym, insertAttr(ctx, sym, 'milestone', 'milestone'), (ops) => ({
		attr: 'milestone',
		value: true,
		at: pointOf(ops),
		replaces: [],
	}));
}

function planSetAttr(ctx: EditContext, intent: IntentOf<'setAttr'>): IntentPlan {
	const sym = taskOf(ctx, intent.task);
	if (isRefused(sym)) return sym;
	const { attr, value } = intent;
	const blocked = macroInBody(ctx, sym, reads(attr));
	if (blocked) return blocked;
	if (attr === 'flags' || attr === 'responsible') {
		return planIdList(ctx, sym, attr, value, insertAttr, removeSites);
	}
	if (attr === 'milestone') {
		return typeof value === 'boolean'
			? planMilestone(ctx, sym, value)
			: refused('invalid-value', [sym.decl.header]);
	}
	const site = SIZING.has(attr) ? null : lastOwn(ctx, sym, attr);
	const v = parseAttrValue(attr, value, [site?.value ?? sym.decl.header]);
	if (isRefused(v)) return v;
	if (SIZING.has(attr)) return planSizing(ctx, sym, attr, v);
	if ((attr === 'start' || attr === 'end') && lastOwn(ctx, sym, 'milestone')) {
		const bounds = conflict(sym, fixedBounds(ctx, sym, { keyword: attr, value: v }));
		if (bounds) return bounds;
	}
	const plan = site ? rewriteValue(ctx, site, attr, v) : insertValue(ctx, sym, attr, v);
	if (!TIMING_ATTRS.has(attr)) return plan;
	return timed(ctx, sym, plan, (ops) => ({
		attr,
		value: v,
		at: site?.statement ?? pointOf(ops),
		replaces: site ? [site] : [],
	}));
}

function planRemoveAttr(ctx: EditContext, intent: IntentOf<'removeAttr'>): IntentPlan {
	const sym = taskOf(ctx, intent.task);
	if (isRefused(sym)) return sym;
	const { attr } = intent;
	const blocked = macroInBody(ctx, sym, reads(attr));
	if (blocked) return blocked;
	const own = ownSites(ctx, sym, attr);
	const written = macroWritten(own);
	if (written) return written;
	if (own.length > 0) {
		const lost = SIZE_OR_MILESTONE.has(attr) ? sizeLost(ctx, sym, own) : null;
		if (lost) return lost;
		const ops = removeSites(ctx, own);
		if (!TIMING_ATTRS.has(attr)) return ops;
		return timed(ctx, sym, ops, () => ({ attr, value: null, at: null, replaces: own }));
	}
	const up = INHERITED.has(attr) ? inheritedSites(ctx, sym, attr) : [];
	return up.length > 0 ? refused('inherited', ranges(up)) : noop('not-present');
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

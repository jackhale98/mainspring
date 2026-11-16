// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The leave-paint planner (phase-3.md 6.6, 7.1 W3 to W5; 18.5, 18.6; ADR-0014 #7). A painted or
 * erased run of days on the calendar becomes one edit intent. The types and the contract were
 * merged first (T2); T12 adds `planLeavePaint`.
 *
 * ## Contract
 *
 * - `planLeavePaint(p, ctx)` is pure: it reads the index and the shown result, and never applies
 *   anything or schedules.
 * - **Paint** becomes `updateLeave` when the range touches or overlaps an item of the same type and
 *   name in that scope (the merged item). Otherwise it becomes `addLeave`.
 * - **Erase** becomes `clearLeave` (6.5, T8).
 * - Days are whole local days of the plan's zone, `[from, to)`. Dates are written with `dateText`;
 *   the interval form is the edit API's (18.5): `<type> "<name>" <start> - <end>`, the end being
 *   the exclusive next day. Defaults: `annual` for a person, holiday for Everyone. A `vacation`
 *   stays readable and is edited as `holiday`. Leave days the engine shows but no text item names
 *   (shifts, macros) are text-only.
 *
 * ## How T12 reads it
 *
 * - The scope's items are the edit API's (paint-items.ts). "Same name" compares the painted name
 *   (none when not given) with the item's, so `annual "Trip"` and a nameless `annual` stay apart. A
 *   vacation interval is a `holiday` with the vacation's name.
 * - **Merge**: the first matching item in reading order (touching: its end is the paint's start,
 *   or its start the paint's end) is rewritten to cover both. Only the bound that moves is
 *   rewritten as a date (`dateText`); the other keeps its written form (`+2d`, the one-day form),
 *   unless the start moves under an end that counts from it, which is then written as the date it
 *   resolved to. A paint inside the item asks for the item as written, so the edit API answers
 *   noop `already-set`.
 * - **Erase**: `clearLeave` over the range in the scope, which removes, trims or splits each item
 *   it overlaps and refuses an inherited one (`inherited`) or a split vacation (`unsupported-form`).
 *   It is `text-only` here when the engine shows leave in the range for the scope (the person's v3
 *   `leaves`, or `ProjectInfo.leaves` for Everyone) and no text item, own or inherited, overlaps
 *   it: those days come from shifts or macros, and the edit API would answer "nothing to remove".
 * - The planner's own refusals (`Planned`): `unknown-target` for a person the text does not
 *   declare; `not-scheduled` without the result's project (no frame to read days in); `at-limit`
 *   for an empty range or one `dateText` cannot write (outside 1970 to 2035, or zone data missing).
 */
// T12: painting one type over another type's leave adds an overlapping item: one stroke is one
// intent, and TaskJuggler's precedence decides which type the scoreboard keeps there. Erase first
// to replace a leave.
// T12: a paint that bridges two items of its type merges with the first only (one intent, one
// item rewritten); the second then touches or overlaps the merged item, which TaskJuggler reads
// the same as one leave.
// T2: 6.6 types the result as `Planned`. The only `Planned` is the Gantt's (gantt/intents.ts), so
// that one is used as it is: paint never asks for the move preference (`ask-move-preference`
// does not occur) and its `constraint` is always false.
import type { Minutes, ProjectInfo, ScheduleResult } from '../../engine/protocol';
import type { Planned } from '../gantt/intents';
import { dateText, displayDate } from '../schedule/date-text';
import { leavePaintStrings as S } from '../strings';
import type { EditIntent, LeaveSpec, LeaveType } from '../tjp/edit/types';
import type { ResourceId, SourceRange, SymbolIndex } from '../tjp/index';
import type { ZoneOffsets } from '../tjp/values/civil';
import { printDate, printDuration } from '../tjp/values';
import { inheritedItems, scopeItems, type PaintItem } from './paint-items';

/** Everyone (global leaves, after the project header), or one person's declaration body. */
// T2: 6.6 writes the scope inline in `paint` and as `LeavePaint['scope']` in `erase`, which does
// not compile (TS2502: the union refers to itself). It is named instead; `LeavePaint['scope']` is
// the same type, and 6.7 uses it so.
export type PaintScope = { kind: 'global' } | { kind: 'resource'; resource: ResourceId };

export type LeavePaint =
	/** Whole local days, `[from, to)`. */
	| {
			type: 'paint';
			scope: PaintScope;
			from: Minutes;
			to: Minutes;
			leave: LeaveType;
			name?: string;
	  }
	| { type: 'erase'; scope: PaintScope; from: Minutes; to: Minutes };

/** What `planLeavePaint` reads. */
export interface LeavePaintContext {
	index: SymbolIndex;
	result: ScheduleResult;
	zones: ZoneOffsets;
}

/** T12: `export const planLeavePaint: PlanLeavePaintFn`. */
export type PlanLeavePaintFn = (p: LeavePaint, ctx: LeavePaintContext) => Planned;

/** 18.5: `annual` for a person, `holiday` for Everyone. */
export const defaultLeaveType = (scope: PaintScope): LeaveType =>
	scope.kind === 'global' ? 'holiday' : 'annual';

const refuse = (
	reason: Extract<Planned, { status: 'not-possible' }>['reason'],
	at: readonly SourceRange[] = [],
): Planned => ({ status: 'not-possible', reason, at });

const planned = (intent: EditIntent, text: string): Planned => ({
	status: 'intent',
	intent,
	label: { text, approx: false },
	constraint: false,
});

const startEpochOf = (p: ProjectInfo): number => Math.round(Date.parse(p.start) / 1000);

/** The days `[from, to)` for people ("10 Jun 2013 to 12 Jun 2013"). */
function daysLabel(project: ProjectInfo, from: Minutes, to: Minutes): string {
	return S.days(
		displayDate(from, project, { style: 'date' }),
		displayDate(to, project, { style: 'date', end: true }),
	);
}

/** An item's interval as a `LeaveSpec`'s dates, as written. */
function writtenSpec(item: PaintItem): { start: string; end?: string } | null {
	const start = printDate(item.interval.start);
	if (!start.ok) return null;
	const end = item.interval.end;
	if (end === null) return { start: start.value };
	const e = end.kind === 'date' ? printDate(end.date) : printDuration(end.duration);
	if (!e.ok) return null;
	return { start: start.value, end: end.kind === 'date' ? e.value : `+${e.value}` };
}

const touches = (item: PaintItem, from: Minutes, to: Minutes): boolean =>
	item.to >= from && item.from <= to;

/** Whether the engine shows leave in `[from, to)` for the scope (module comment). */
function engineLeaveIn(
	result: ScheduleResult,
	scope: PaintScope,
	from: Minutes,
	to: Minutes,
): boolean {
	const project = result.project;
	const scenario = project?.scenarios.find((s) => s.active)?.id ?? null;
	const hit = (iv: readonly [Minutes, Minutes]): boolean => iv[1] > from && iv[0] < to;
	if (scope.kind === 'global') return (project?.leaves ?? []).some((l) => hit(l.interval));
	const r = result.resources.find((x) => x.id === scope.resource);
	const rs = scenario === null ? undefined : r?.scenarios[scenario];
	return (rs?.leaves ?? []).some((l) => l.intervals.some(hit));
}

export const planLeavePaint: PlanLeavePaintFn = (p, ctx) => {
	const { index, result, zones } = ctx;
	const project = result.project;
	let who: string = S.everyone;
	let at: SourceRange[] = [];
	if (p.scope.kind === 'resource') {
		const sym = index.resources.get(p.scope.resource);
		if (!sym) return refuse('unknown-target');
		who = sym.name ?? sym.id;
		at = [sym.decl.header];
	}
	if (!project) return refuse('not-scheduled', at);
	if (!(p.to > p.from)) return refuse('at-limit', at);
	const start = dateText(p.from, project, zones);
	const end = dateText(p.to, project, zones);
	if (start === null || end === null) return refuse('at-limit', at);
	const scope = p.scope.kind === 'global' ? { kind: 'global' as const } : p.scope;
	const epoch = startEpochOf(project);
	const own = scopeItems(index, p.scope, epoch);

	if (p.type === 'erase') {
		const overlaps = (i: PaintItem): boolean => i.to > p.from && i.from < p.to;
		const text =
			own.some(overlaps) ||
			(p.scope.kind === 'resource' &&
				inheritedItems(index, p.scope.resource, epoch).some(overlaps));
		if (!text && engineLeaveIn(result, p.scope, p.from, p.to)) return refuse('text-only', at);
		return planned(
			{ type: 'clearLeave', scope, start, end },
			S.label.erase(who, daysLabel(project, p.from, p.to)),
		);
	}

	const name = p.name ?? null;
	const type = S.type[p.leave];
	const item = own.find((i) => i.type === p.leave && i.name === name && touches(i, p.from, p.to));
	const named = p.name === undefined ? {} : { name: p.name };
	if (!item) {
		return planned(
			{ type: 'addLeave', scope, leave: { type: p.leave, ...named, start, end } },
			S.label.add(type, who, daysLabel(project, p.from, p.to)),
		);
	}
	const written = writtenSpec(item);
	if (!written) return refuse('at-limit', [item.range]);
	const moveStart = p.from < item.from;
	const moveEnd = p.to > item.to;
	let to: LeaveSpec;
	if (!moveStart && !moveEnd) {
		to = { type: p.leave, ...named, ...written };
	} else {
		// An end that counts from the start (`+2d`, the one-day form) must not follow a new start.
		const endAt = item.interval.end?.kind === 'date' ? written.end : undefined;
		const itemEnd = endAt ?? (moveStart ? dateText(item.to, project, zones) : written.end);
		const newEnd = moveEnd ? end : itemEnd;
		if (newEnd === null) return refuse('at-limit', [item.range]);
		to = {
			type: p.leave,
			...named,
			start: moveStart ? start : written.start,
			...(newEnd === undefined ? {} : { end: newEnd }),
		};
	}
	const merged = daysLabel(project, Math.min(item.from, p.from), Math.max(item.to, p.to));
	return planned(
		{ type: 'updateLeave', leave: { item: item.range }, to },
		S.label.merge(type, who, merged),
	);
};

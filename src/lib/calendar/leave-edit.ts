// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Changing or removing one leave in its details (phase-3.md 7.1 W5, 9.5): the fields the Calendar
 * shows for a leave item (type, name, first day, last day) and the edit intent a change of them
 * becomes. T12's planner (paint.ts) plans strokes over days; this plans the edit of one item by
 * its range, and takes the item and its written form from the same reader (paint-items.ts,
 * `writtenSpec`), so it adds no second reading of the text.
 *
 * - **Last day** is inclusive for people ("Fri 6 Mar"); the text's end is the next day, exclusive
 *   (18.5). A leave that does not run from midnight to midnight (a time in the date) has no such
 *   fields: `itemFields` is null and the details say "Edit as text".
 * - **Only what changed is rewritten.** The bound that did not move keeps its written form
 *   (`+2d`, the one-day form), as a merge does; a start that moves under an end that counts from it
 *   writes that end as the date it was.
 * - **Types.** The edit API writes `holiday`, `annual`, `special`, `sick`, `unpaid` and
 *   `unemployed` (`EDIT_TYPES`); a `project` leave is read but not written here.
 * - **Refusals** are the edit API's, through the dispatcher: a macro or a leave in a shared
 *   declaration. This only refuses what cannot be written: a last day before the first, or dates
 *   outside 1970 to 2035.
 * - **On the text now** (ADR-0018 decision 5): `leaveEditPlan(ref, fields, ctx)` and
 *   `leaveRemovePlan(ref, ctx)` are view planners for `dispatchPlan`. The dispatcher calls them on
 *   the text now; they map `ref` there (`mapRange`, the untouched-span rule) and plan against the
 *   item as the fresh index reads it, so "unchanged" and the written forms are judged against the
 *   text now. An item that was touched since `ref.basedOn`, or that the index no longer reads, is
 *   refused with the edit API's `target-changed` sentence; a field error with its own sentence
 *   (`C.details.errors`). After an applied edit the item is the edit's `select`, at the outcome's
 *   version.
 */
import type { Minutes, ProjectInfo } from '../../engine/protocol';
import type { ToastLabel } from '../gantt/intents';
import { dateText, displayDate } from '../schedule/date-text';
import type { PlanBase, ViewPlanner } from '../state/edits-types';
import { refusalStrings } from '../strings';
import { calendarStrings as C, leavePaintStrings as L } from '../strings-calendar';
import type {
	EditIntent,
	LeaveRef,
	LeaveSpec,
	LeaveType as EditLeaveType,
} from '../tjp/edit/types';
import type { SymbolIndex } from '../tjp/index';
import {
	civilFromDays,
	daysFromCivil,
	lastDayOfMonth,
	type ZoneOffsets,
} from '../tjp/values/civil';
import type { LeaveType } from '../tjp/values';
import { writtenSpec } from './paint';
import { scopeItems, type PaintItem } from './paint-items';

/** The types the edit API writes. */
export const EDIT_TYPES: readonly EditLeaveType[] = [
	'annual',
	'special',
	'sick',
	'unpaid',
	'unemployed',
	'holiday',
];

/** The types offered for a scope: a person's leave kinds, or `holiday` for Everyone (9.5). */
export const typesFor = (global: boolean): readonly EditLeaveType[] =>
	global ? ['holiday'] : ['annual', 'special', 'sick', 'unpaid', 'unemployed'];

/** The types a leave item can be changed to: its scope's, and its own when it is another kind. */
export function typesOfItem(item: PaintItem): readonly EditLeaveType[] {
	const base = typesFor(item.site.scope.kind === 'global');
	const own = item.type as EditLeaveType;
	return EDIT_TYPES.includes(own) && !base.includes(own) ? [...base, own] : base;
}

export interface LeaveFields {
	type: LeaveType;
	/** '' for none. */
	name: string;
	/** First day, `yyyy-mm-dd`. */
	start: string;
	/** Last day, inclusive, `yyyy-mm-dd`. */
	end: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A `yyyy-mm-dd` as a day number, or null when it is not a real date. */
function dayNumber(text: string): number | null {
	const m = DATE.exec(text);
	if (!m) return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])] as const;
	if (mo < 1 || mo > 12 || d < 1 || d > lastDayOfMonth(mo, y)) return null;
	return daysFromCivil(y, mo, d);
}

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

/** The `yyyy-mm-dd` of a day number. */
function dateOf(n: number): string {
	const c = civilFromDays(n);
	return `${pad(c.year, 4)}-${pad(c.month, 2)}-${pad(c.day, 2)}`;
}

/** TaskJuggler can write 1970 to 2035 (`dateText`). */
const inRange = (n: number): boolean =>
	n >= daysFromCivil(1970, 1, 1) && n <= daysFromCivil(2035, 12, 31);

/**
 * The fields of an item as the details show them, or null when the item does not run over whole
 * local days (a time of day in a bound), which only the text can say.
 */
export function itemFields(
	item: PaintItem,
	project: Pick<ProjectInfo, 'start' | 'timezone'>,
	zones: ZoneOffsets,
): LeaveFields | null {
	const a = dateText(item.from, project, zones);
	const b = dateText(item.to, project, zones);
	const first = a === null ? null : dayNumber(a);
	const next = b === null ? null : dayNumber(b);
	if (first === null || next === null || next <= first) return null;
	return { type: item.type, name: item.name ?? '', start: dateOf(first), end: dateOf(next - 1) };
}

export type LeaveEditPlan =
	| { readonly status: 'intent'; readonly intent: EditIntent; readonly label: ToastLabel }
	/** Nothing to write: the fields are what the item already says. */
	| { readonly status: 'unchanged' }
	| { readonly status: 'invalid'; readonly reason: 'empty' | 'dates' | 'range' };

export interface EditContext {
	readonly index: SymbolIndex;
	readonly project: ProjectInfo;
	readonly zones: ZoneOffsets;
}

/** Who a leave is for, in the sentences: Everyone, or the person's name. */
export function whoOf(item: PaintItem, index: SymbolIndex): string {
	const s = item.site.scope;
	if (s.kind === 'global' || s.resource === null) return L.everyone;
	const r = index.resources.get(s.resource);
	return r?.name ?? s.resource;
}

/** Day numbers are shown with `displayDate` on a minute; an edited leave's days come from text. */
const shown = (n: number): string => {
	const c = civilFromDays(n);
	return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
		new Date(Date.UTC(c.year, c.month - 1, c.day)),
	);
};

/** The intent that changes `item` to `f`, or why it cannot. */
export function planLeaveEdit(item: PaintItem, f: LeaveFields, ctx: EditContext): LeaveEditPlan {
	const orig = itemFields(item, ctx.project, ctx.zones);
	const written = writtenSpec(item);
	if (!orig || !written) return { status: 'invalid', reason: 'range' };
	const first = dayNumber(f.start);
	const last = dayNumber(f.end);
	if (first === null || last === null) return { status: 'invalid', reason: 'empty' };
	if (last < first) return { status: 'invalid', reason: 'dates' };
	if (!inRange(first) || !inRange(last + 1)) return { status: 'invalid', reason: 'range' };
	const name = f.name.trim();
	if (f.type === orig.type && name === orig.name && f.start === orig.start && f.end === orig.end) {
		return { status: 'unchanged' };
	}
	const startMoved = f.start !== orig.start;
	const endMoved = f.end !== orig.end;
	// The end: the new day after the last when it moved; as written when nothing under it moved; and
	// when only the start moved, a dated end keeps its text and one that counts from the start (`+2d`,
	// the one-day form) becomes the date it was.
	const resolved = dateText(item.to, ctx.project, ctx.zones);
	const end: string | null | undefined = endMoved
		? dateOf(last + 1)
		: !startMoved || item.interval.end?.kind === 'date'
			? written.end
			: resolved;
	if (end === null) return { status: 'invalid', reason: 'range' };
	const to: LeaveSpec = {
		type: f.type as EditLeaveType,
		...(name === '' ? {} : { name }),
		start: startMoved ? f.start : written.start,
		...(end === undefined ? {} : { end }),
	};
	return {
		status: 'intent',
		intent: { type: 'updateLeave', leave: { item: item.range, basedOn: item.version }, to },
		label: {
			text: C.label.change(
				L.type[f.type],
				whoOf(item, ctx.index),
				L.days(shown(first), shown(last)),
			),
			approx: false,
		},
	};
}

/** The intent that removes `item`. */
export function planLeaveRemove(
	item: PaintItem,
	ctx: Pick<EditContext, 'index' | 'project'>,
): Extract<LeaveEditPlan, { status: 'intent' }> {
	const days = L.days(
		displayDate(item.from as Minutes, ctx.project, { style: 'date' }),
		displayDate(item.to as Minutes, ctx.project, { style: 'date', end: true }),
	);
	return {
		status: 'intent',
		intent: { type: 'removeLeave', leave: { item: item.range, basedOn: item.version } },
		label: {
			text: C.label.removed(L.type[item.type], whoOf(item, ctx.index), days),
			approx: false,
		},
	};
}

/** What a leave card's commit came to: a field error, or whether the edit was applied (W5). */
export interface CommitResult {
	readonly error?: 'empty' | 'dates' | 'range';
	readonly applied?: boolean;
}

/** The item `ref` names, in the text now, or null when it was touched or is no longer read. */
export function itemNow(
	on: PlanBase,
	ref: LeaveRef,
	project: Pick<ProjectInfo, 'start'>,
): PaintItem | null {
	const r = on.mapRange(ref.item, ref.basedOn);
	if (!r) return null;
	const at = (x: { file: string; from: number; to: number }): boolean =>
		x.file === r.file && x.from === r.from && x.to === r.to;
	const site = on.index.leaves.find((l) => l.items.some(at));
	const scope = site?.scope;
	if (!scope || (scope.kind === 'resource' && scope.resource === null)) return null;
	const items = scopeItems(
		on.index,
		scope.kind === 'global' ? scope : { kind: 'resource', resource: scope.resource as string },
		Math.round(Date.parse(project.start) / 1000),
	);
	return items.find((i) => at(i.range)) ?? null;
}

const changed = {
	status: 'not-possible',
	message: refusalStrings['target-changed'],
	at: [],
} as const;

/** A leave card's commit, planned on the text now (module comment). */
export function leaveEditPlan(
	ref: LeaveRef,
	f: LeaveFields,
	ctx: Omit<EditContext, 'index'>,
): ViewPlanner {
	return (on) => {
		const item = itemNow(on, ref, ctx.project);
		if (!item) return changed;
		const p = planLeaveEdit(item, f, { ...ctx, index: on.index });
		if (p.status === 'invalid') {
			return { status: 'not-possible', message: C.details.errors[p.reason], at: [item.range] };
		}
		return p.status === 'unchanged' ? { status: 'unchanged' } : p;
	};
}

/** A leave card's Remove, planned on the text now (module comment). */
export function leaveRemovePlan(ref: LeaveRef, ctx: Pick<EditContext, 'project'>): ViewPlanner {
	return (on) => {
		const item = itemNow(on, ref, ctx.project);
		return item ? planLeaveRemove(item, { ...ctx, index: on.index }) : changed;
	};
}

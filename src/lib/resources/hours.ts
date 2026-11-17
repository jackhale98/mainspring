// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The working-hours editor's model (phase-3.md 9.6, 7.1 W8): the week a scope works as the text says
 * it, and the `setWorkingHours` intent for a change of one day. Shared by the person details and
 * the project sheet. Read from the symbol index, as every field of the inspector is, so the editor
 * says what the text says; the engine's `workingTime` is not read here (it has leaves and bookings
 * mixed in, and the editor shows hours, not availability).
 *
 * - **The project's week** is TaskJuggler's default (Mon-Fri 9:00 to 17:00) with each `workinghours`
 *   statement of the project body applied in reading order, later ones overriding the days they
 *   name. A `timezone` or `timingresolution` statement resets the hours (Project#[]=), so the
 *   statements above the last one in the same file do not count.
 * - **A person's week** starts from their parent group's (or the project's) and applies the person's
 *   own statements in the top scenario (supplement bodies too). Both the attribute's definition in
 *   TaskJuggler (inherited from the parent and from the project) and the edit API say so. One
 *   approximation: a group's statement read after the person was declared does not reach the person
 *   in TaskJuggler, and does here (the engine check in hours.engine.test.ts holds for plans that
 *   declare a group's hours before its members, which is how people write them).
 * - **Text only**: a statement written with a macro, or one the index could not read, makes the
 *   week unknown. The editor is then off, with the reason and "Show in text".
 * - **A change** is the hours of one day (`'off'` or ranges). The edit API writes the minimal
 *   statement: it rewrites the last own statement for exactly that day, else adds one after the
 *   scope's last.
 */
import type { ToastLabel } from '../gantt/intents';
import { hoursStrings as H } from '../strings-resources';
import { ownSites, sameFileBefore, type ReadBefore } from './sites';
import type { Scope } from '../tjp/edit/types';
import type { AttrSite, ResourceId, SourceRange, SymbolIndex, TextOnlyReason } from '../tjp/index';
import {
	applyWorkingHours,
	DEFAULT_WEEK,
	parseTimeOfDay,
	printTimeOfDay,
	TJ_WEEKDAYS,
	WEEKDAYS,
	type TimeRange,
	type Weekday,
	type WeekTable,
} from '../tjp/values';

/** One weekday of the editor: `ranges` is empty for a day off. */
export interface DayHours {
	readonly day: Weekday;
	readonly ranges: readonly TimeRange[];
}

export type WeekReading =
	| {
			readonly kind: 'week';
			/** Monday first (the order of `WEEKDAYS`). */
			readonly days: readonly DayHours[];
			/** Whether the scope writes any `workinghours` itself, or takes them from above. */
			readonly own: boolean;
	  }
	| {
			readonly kind: 'text-only';
			readonly reason: TextOnlyReason | 'unreadable';
			readonly at: SourceRange;
	  };

type Applied = { readonly week: WeekTable; readonly own: boolean } | WeekReading;

const isReading = (a: Applied): a is WeekReading => 'kind' in a;

/** Applies a scope's `workinghours` statements to a week, or says why it cannot. */
function apply(week: WeekTable, sites: readonly AttrSite[]): Applied {
	let out = week;
	for (const s of sites) {
		if (s.textOnly) return { kind: 'text-only', reason: s.textOnly.reason, at: s.statement };
		if (s.parsed?.kind !== 'workinghours')
			return { kind: 'text-only', reason: 'unreadable', at: s.statement };
		out = applyWorkingHours(out, s.parsed.value);
	}
	return { week: out, own: sites.length > 0 };
}

const same = (a: SourceRange, b: SourceRange): boolean => a.file === b.file;

/** The project's week (module comment), as read before `before` (a resource's header), if given. */
function projectApplied(
	index: SymbolIndex,
	before: SourceRange | null,
	readBefore: ReadBefore,
): Applied {
	const p = index.project;
	if (!p) return { week: DEFAULT_WEEK, own: false };
	const reset = p.attrs
		.filter((a) => a.keyword === 'timezone' || a.keyword === 'timingresolution')
		.at(-1);
	const sites = ownSites(index, p.attrs, 'workinghours').filter(
		(s) =>
			// A statement above the last reset, in the same file, is overwritten by it.
			!(reset && same(s.statement, reset.statement) && s.statement.from < reset.statement.from) &&
			(before === null || readBefore(s.statement, before)),
	);
	return apply(DEFAULT_WEEK, sites);
}

/**
 * A person's or group's week: the parent's (or the project's) as it stood when they were declared,
 * then their own statements, which all count (a supplement's too). A parent's statement read after
 * the resource's header does not reach it, as in TaskJuggler (a resource copies its parent's hours
 * when it is created), so a `supplement resource team { workinghours ... }` below the members, or a
 * group's statement written after them, changes the group and not them.
 */
function resourceApplied(
	index: SymbolIndex,
	id: ResourceId,
	seen: Set<ResourceId>,
	before: SourceRange | null,
	readBefore: ReadBefore,
): Applied {
	const sym = index.resources.get(id);
	if (!sym || seen.has(id)) return projectApplied(index, before, readBefore);
	seen.add(id);
	const own = ownSites(index, sym.attrs, 'workinghours').filter(
		(s) => before === null || readBefore(s.statement, before),
	);
	const base =
		sym.parent === null
			? projectApplied(index, sym.decl.header, readBefore)
			: resourceApplied(index, sym.parent, seen, sym.decl.header, readBefore);
	if (isReading(base)) return base;
	const mine = apply(base.week, own);
	return isReading(mine) ? mine : { week: mine.week, own: mine.own };
}

function reading(a: Applied): WeekReading {
	if (isReading(a)) return a;
	const days = WEEKDAYS.map((day) => ({
		day,
		ranges: a.week[TJ_WEEKDAYS.indexOf(day)] ?? [],
	}));
	return { kind: 'week', days, own: a.own };
}

/**
 * The week of a scope as the text says it. `readBefore` is the reading order of the plan
 * (`readBeforeOf(snapshot.includes)`); without it positions in one file are compared by offset.
 */
export function weekOf(
	index: SymbolIndex,
	scope: Scope,
	readBefore: ReadBefore = sameFileBefore,
): WeekReading {
	return reading(
		scope.kind === 'project'
			? projectApplied(index, null, readBefore)
			: resourceApplied(index, scope.resource, new Set(), null, readBefore),
	);
}

/** `9:00` for 540; `24:00` for the end of the day. */
export const timeText = (minutes: number): string => {
	const t = printTimeOfDay(minutes);
	return t.ok ? t.value : '';
};

/** The minutes of a typed time (`9:00`, `09:00`, `17`), or null when TaskJuggler would not read it. */
export function parseTime(text: string): number | null {
	const t = text.trim();
	if (!/^\d{1,2}(:[0-5]\d)?$/.test(t)) return null;
	const full = t.includes(':') ? t : `${t}:00`;
	const p = parseTimeOfDay(full);
	return p.ok ? p.value : null;
}

/** The ranges as TaskJuggler writes them in `setWorkingHours` (`['9:00', '12:00']` pairs). */
export const pairsOf = (ranges: readonly TimeRange[]): Array<[string, string]> =>
	ranges.map(([s, e]) => [timeText(s), timeText(e)]);

export type HoursChange =
	| { readonly status: 'intent'; readonly intent: IntentWH; readonly label: ToastLabel }
	/** The typed hours are not hours: the field says so and nothing is sent. */
	| { readonly status: 'invalid'; readonly reason: 'time' | 'order' };

type IntentWH = {
	readonly type: 'setWorkingHours';
	readonly scope: Scope;
	readonly days: readonly Weekday[];
	readonly hours: ReadonlyArray<readonly [string, string]> | 'off';
};

/** How a day's hours read in a toast and the history: `Mon 9:00 - 12:00, 13:00 - 17:00`, `Sat off`. */
export function hoursPhrase(ranges: readonly TimeRange[]): string {
	return ranges.length === 0
		? H.off
		: ranges.map(([s, e]) => `${timeText(s)} - ${timeText(e)}`).join(', ');
}

/** What the working-hours editor changes one day to: `null` ranges is the day off. */
export function changeDay(
	scope: Scope,
	who: string,
	day: Weekday,
	ranges: ReadonlyArray<readonly [number, number]>,
): HoursChange {
	for (const [s, e] of ranges) {
		if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 24 * 60)
			return { status: 'invalid', reason: 'time' };
		if (s >= e) return { status: 'invalid', reason: 'order' };
	}
	const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
	for (let i = 1; i < sorted.length; i++) {
		if ((sorted[i]?.[0] ?? 0) < (sorted[i - 1]?.[1] ?? 0))
			return { status: 'invalid', reason: 'order' };
	}
	return {
		status: 'intent',
		intent: {
			type: 'setWorkingHours',
			scope,
			days: [day],
			hours: sorted.length === 0 ? 'off' : pairsOf(sorted),
		},
		label: {
			text: H.label(who, H.day[day], hoursPhrase(sorted)),
			approx: false,
		},
	};
}

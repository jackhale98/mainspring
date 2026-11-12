// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The project finish date (phase-1.md 6.8 and 8.2): the latest task end in the first active
 * scenario of a schedule result, which in declaration pre-order is the top active one.
 *
 * Read from the engine's result only; nothing here schedules. Dates stay integer minutes since
 * the project start (ADR-0002 #4); `date` is the same instant as ISO 8601 UTC and exists for
 * display with `Intl` (`formatFinish`). The delta against an earlier finish compares instants,
 * so it stays right when the project start moved between the two results.
 */
import type { Minutes, Revision, ScheduleResult } from '../../engine/protocol';

export interface Finish {
	/** Minutes since `projectStart`; what views compute with. */
	readonly minutes: Minutes;
	/** The same instant as ISO 8601 UTC (`2026-03-02T17:00:00Z`), for display only. */
	readonly date: string;
	/** The scenario the finish was read from. */
	readonly scenario: string;
	/** ProjectInfo.start of the result (ISO 8601 UTC). */
	readonly projectStart: string;
	/** The plan's time zone as written; null means UTC for display. */
	readonly timezone: string | null;
	/** Minutes later (positive) or earlier (negative) than the previous finish; null without one. */
	readonly delta: Minutes | null;
	readonly revision: Revision;
}

const MINUTE_MS = 60_000;

/** The first active scenario in declaration pre-order, or null. */
export function finishScenario(r: ScheduleResult): string | null {
	return r.project?.scenarios.find((s) => s.active)?.id ?? null;
}

/** Latest end over the scheduled tasks of the first active scenario; null if none is scheduled. */
export function finishMinutes(r: ScheduleResult): Minutes | null {
	const scenario = finishScenario(r);
	if (scenario === null) return null;
	let max: Minutes | null = null;
	for (const t of r.tasks) {
		const s = t.scenarios[scenario];
		if (!s || !s.scheduled || s.end === null) continue;
		if (max === null || s.end > max) max = s.end;
	}
	return max;
}

/** ISO 8601 UTC of `minutes` after `start`, without milliseconds (the protocol's style). */
export function isoAt(start: string, minutes: Minutes): string {
	return new Date(Date.parse(start) + minutes * MINUTE_MS).toISOString().replace('.000Z', 'Z');
}

/** Minutes from `a` to `b`, as instants. */
export function finishDelta(a: Finish, b: Finish): Minutes {
	if (a.projectStart === b.projectStart) return b.minutes - a.minutes;
	const shift = (Date.parse(b.projectStart) - Date.parse(a.projectStart)) / MINUTE_MS;
	return b.minutes - a.minutes + shift;
}

/** The finish of a result, with the delta against `previous` (an earlier result's finish). */
export function finishOf(r: ScheduleResult, previous: Finish | null = null): Finish | null {
	const minutes = finishMinutes(r);
	const scenario = finishScenario(r);
	if (minutes === null || scenario === null || r.project === null) return null;
	const start = r.project.start;
	const base = {
		minutes,
		date: isoAt(start, minutes),
		scenario,
		projectStart: start,
		timezone: r.project.timezone,
		revision: r.revision,
	};
	return { ...base, delta: previous === null ? null : finishDelta(previous, { ...base, delta: null }) };
}

/**
 * The finish date for display, in the project's time zone (UTC when unset, or when `Intl` does
 * not know the zone). `options` defaults to a medium date and a short time.
 */
export function formatFinish(
	f: Finish,
	locales?: string | readonly string[],
	options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
	const at = new Date(Date.parse(f.date));
	const list = typeof locales === 'string' ? locales : locales ? [...locales] : undefined;
	try {
		return new Intl.DateTimeFormat(list, { ...options, timeZone: f.timezone ?? 'UTC' }).format(at);
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		return new Intl.DateTimeFormat(list, { ...options, timeZone: 'UTC' }).format(at);
	}
}

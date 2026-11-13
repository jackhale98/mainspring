// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Minutes to date text (phase-2.md 6.2; phase-1.md 6.5 left "converting Minutes to date text" to
 * Phase 2), two ways:
 *
 * - `dateText` is TaskJuggler date text for writing into the plan: local time in the project's
 *   zone, `2026-03-09` at midnight and `2026-03-09-13:00` otherwise, with an explicit offset only
 *   where the local time is ambiguous (a DST overlap). It parses back to the same instant with
 *   values/date.ts (`dateFromEpoch` is the canonical writer; the tests check the round trip).
 * - `displayDate` is for people: `Intl` in the project's zone (UTC when the plan sets none, or
 *   when `Intl` does not know the zone), in the viewer's locale unless one is given. A snapped
 *   date in a drag label is a target, not a result (ADR-0007).
 *
 * Integer minutes since the project start in, text out; nothing here schedules.
 */
import type { Minutes, ProjectInfo } from '../../engine/protocol';
import type { ZoneOffsets } from '../tjp/values/civil';
import { dateFromEpoch, printTjDate } from '../tjp/values/date';

const MINUTE_MS = 60_000;

/** The project start as epoch seconds. */
const startEpoch = (p: Pick<ProjectInfo, 'start'>): number =>
	Math.round(Date.parse(p.start) / 1000);

/**
 * TaskJuggler date text for `m` in the project's zone, or null when the instant cannot be written
 * as a TaskJuggler date (outside 1970..2035, or zone data missing for a zone other than UTC).
 */
export function dateText(
	m: Minutes,
	project: Pick<ProjectInfo, 'start' | 'timezone'>,
	zones?: ZoneOffsets,
): string | null {
	const env = { zone: project.timezone, ...(zones ? { zones } : {}) };
	const d = dateFromEpoch(startEpoch(project) + m * 60, env);
	if (d === null) return null;
	const text = printTjDate(d);
	return text.ok ? text.value : null;
}

/**
 * How a date is shown:
 * - 'date': medium date ("9 Mar 2026");
 * - 'weekday': weekday, day and month ("Mon 9 Mar"), for drag labels;
 * - 'date-time': medium date and short time;
 * - 'time': short time.
 */
export type DisplayStyle = 'date' | 'weekday' | 'date-time' | 'time';

const STYLES: Readonly<Record<DisplayStyle, Intl.DateTimeFormatOptions>> = {
	date: { dateStyle: 'medium' },
	weekday: { weekday: 'short', day: 'numeric', month: 'short' },
	'date-time': { dateStyle: 'medium', timeStyle: 'short' },
	time: { timeStyle: 'short' },
};

export interface DisplayOptions {
	style?: DisplayStyle;
	/** BCP 47 tag; undefined means the viewer's own. */
	locale?: string | undefined;
	/**
	 * The minute is an end instant: a date-only style shows the day of the minute before it, so a
	 * task that ends at midnight shows the last day it worked.
	 */
	end?: boolean;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
	locale: string | undefined,
	zone: string,
	style: DisplayStyle,
): Intl.DateTimeFormat {
	const key = `${locale ?? ''}|${zone}|${style}`;
	let f = formatters.get(key);
	if (!f) {
		try {
			f = new Intl.DateTimeFormat(locale, { ...STYLES[style], timeZone: zone });
		} catch (error) {
			if (!(error instanceof RangeError)) throw error;
			f = new Intl.DateTimeFormat(locale, { ...STYLES[style], timeZone: 'UTC' });
		}
		formatters.set(key, f);
	}
	return f;
}

/** `m` for people, with `Intl`, in the project's zone. */
export function displayDate(
	m: Minutes,
	project: Pick<ProjectInfo, 'start' | 'timezone'>,
	opts: DisplayOptions = {},
): string {
	const style = opts.style ?? 'date';
	const dateOnly = style === 'date' || style === 'weekday';
	const at = Date.parse(project.start) + (opts.end && dateOnly ? m - 1 : m) * MINUTE_MS;
	return formatter(opts.locale, project.timezone ?? 'UTC', style).format(new Date(at));
}

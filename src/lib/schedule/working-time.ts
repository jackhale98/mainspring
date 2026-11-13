// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Working-minute arithmetic over the project's working time (phase-2.md 6.2): the [start, end)
 * pairs of `ProjectInfo.workingTime` (bridge schema v2), which TaskJuggler read slot by slot from
 * its project scoreboard (`Project#isWorkingTime`: the global working hours minus global leaves, in
 * the plan's zone, DST applied). This module only reads them; it never schedules (ADR-0007).
 *
 * The rules mirror how TaskJuggler walks slots for a `gaplength` (TaskScenario#earliestStart and
 * #latestEnd, TaskScenario.rb:1173-1258):
 * - `addWorking(a, w)` for w > 0 is the earliest instant with w working minutes in [a, t): the end
 *   of the last working slot counted. Past the last working minute it gives the frame end, where
 *   TaskJuggler's walk stops (`while ... date < @project['end']`).
 * - `addWorking(a, -w)` is the latest instant t with w working minutes in [t, a): the start of the
 *   earliest slot counted back. Before the first working minute it gives the frame start (0).
 * - `workingBetween(a, b)` is signed: negative when b is before a.
 *
 * Working days (`dayStart`, `dayEnd`, `shiftDays`) are local calendar days in the plan's zone that
 * hold working time. They need zone data for a zone other than UTC (`zones`); without it the days
 * fall back to UTC days. They are built on first use, since the driving-path analysis never needs
 * them. A start instant belongs to the day that holds it; an end instant to the day of the minute
 * before it, so a task that ends at midnight ends on the day it worked.
 *
 * All lookups are binary searches over typed arrays: O(log n) per call, no allocation.
 */
import type { Minutes, ProjectInfo } from '../../engine/protocol';
import {
	civilFromDays,
	daysFromCivil,
	epochToLocal,
	fieldsFromUtc,
	localToEpoch,
	type ZoneEnv,
	type ZoneOffsets,
} from '../tjp/values/civil';

export type DayRole = 'start' | 'end';

export interface WorkingTime {
	/** `timingResolutionMin`: every working bound is a multiple of it. */
	readonly resolution: number;
	/** The project end, in minutes since its start. */
	readonly frameEnd: Minutes;
	/** Working minutes in the whole frame. */
	readonly total: number;
	/** Whether the minute [m, m + 1) is working time. */
	isWorking(m: Minutes): boolean;
	/** Working minutes in [a, b); negative when b < a. */
	workingBetween(a: Minutes, b: Minutes): number;
	/** The instant `work` working minutes after a (before a when `work` is negative). */
	addWorking(a: Minutes, work: number): Minutes;
	/**
	 * Snaps to working time: a start moves forward to the next working minute (m itself when it is
	 * working), an end moves back to the end of the last working minute (m itself when the minute
	 * before it is working). m is returned unchanged when there is nothing to snap to.
	 */
	snap(m: Minutes, role: DayRole): Minutes;
	/** Start of the working day containing or after m (first working minute of that day). */
	dayStart(m: Minutes): Minutes;
	/** End of the working day containing or before m (an end instant: see the module comment). */
	dayEnd(m: Minutes): Minutes;
	/** Shift by whole working days (negative allowed), keeping the role: a day's start or end. */
	shiftDays(m: Minutes, days: number, role: DayRole): Minutes;
}

const MINUTE_MS = 60_000;

/** The index of the last element of `xs[0..n)` that is <= x (or < x when `strict`), or -1. */
function lastAtOrBefore(xs: Float64Array, n: number, x: number, strict: boolean): number {
	let lo = 0;
	let hi = n;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		const v = xs[mid] as number;
		if (strict ? v < x : v <= x) lo = mid + 1;
		else hi = mid;
	}
	return lo - 1;
}

/** The index of the first element of `xs[0..n)` that is >= x (or > x when `strict`), or n. */
function firstAtOrAfter(xs: Float64Array, n: number, x: number, strict: boolean): number {
	return lastAtOrBefore(xs, n, x, !strict) + 1;
}

interface Days {
	readonly n: number;
	/** Civil day numbers (days since 1970-01-01, local), ascending. */
	readonly key: Float64Array;
	readonly start: Float64Array;
	readonly end: Float64Array;
}

/**
 * Working time from the pairs as the bridge emits them (ascending, disjoint, merged). Pairs are
 * defensively sorted and merged again, so a hand-written list works too.
 */
export function workingTimeFromPairs(
	pairs: ReadonlyArray<readonly [Minutes, Minutes]>,
	opts: {
		resolution: number;
		frameEnd: Minutes;
		/** For working days: the project start (epoch seconds) and the zone dates are read in. */
		startEpoch?: number;
		env?: ZoneEnv;
	},
): WorkingTime {
	const sorted = pairs.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
	const merged: Array<[number, number]> = [];
	for (const [a, b] of sorted) {
		const last = merged[merged.length - 1];
		if (last && a <= last[1]) last[1] = Math.max(last[1], b);
		else merged.push([a, b]);
	}
	const n = merged.length;
	const starts = new Float64Array(n);
	const ends = new Float64Array(n);
	/** Working minutes before pair i, and through the end of pair i. */
	const cum = new Float64Array(n);
	const cumEnd = new Float64Array(n);
	let acc = 0;
	merged.forEach(([a, b], i) => {
		starts[i] = a;
		ends[i] = b;
		cum[i] = acc;
		acc += b - a;
		cumEnd[i] = acc;
	});
	const total = acc;
	const frameEnd = opts.frameEnd;

	/** Working minutes in (-inf, m). */
	const cumAt = (m: number): number => {
		const i = lastAtOrBefore(starts, n, m, false);
		if (i < 0) return 0;
		return (cum[i] as number) + Math.min(m, ends[i] as number) - (starts[i] as number);
	};

	const addWorking = (a: Minutes, work: number): Minutes => {
		if (work === 0 || n === 0) return work === 0 ? a : work > 0 ? Math.max(a, frameEnd) : 0;
		const target = cumAt(a) + work;
		if (work > 0) {
			if (target > total) return Math.max(a, frameEnd);
			// The first pair whose running total reaches the target: the earliest instant.
			const j = firstAtOrAfter(cumEnd, n, target, false);
			return (starts[j] as number) + (target - (cum[j] as number));
		}
		if (target < 0) return 0;
		// The first pair whose running total passes the target: the latest instant.
		const j = firstAtOrAfter(cumEnd, n, target, true);
		return (starts[j] as number) + (target - (cum[j] as number));
	};

	const isWorking = (m: Minutes): boolean => {
		const i = lastAtOrBefore(starts, n, m, false);
		return i >= 0 && m < (ends[i] as number);
	};

	const snap = (m: Minutes, role: DayRole): Minutes => {
		if (role === 'start') {
			const i = lastAtOrBefore(starts, n, m, false);
			if (i >= 0 && m < (ends[i] as number)) return m;
			return i + 1 < n ? (starts[i + 1] as number) : m;
		}
		const i = lastAtOrBefore(starts, n, m, true);
		if (i < 0) return m;
		return Math.min(m, ends[i] as number);
	};

	let days: Days | null = null;
	const daysOf = (): Days => {
		days ??= buildDays(starts, ends, n, opts.startEpoch ?? 0, opts.env ?? { zone: null });
		return days;
	};
	const dayKey = (m: Minutes): number => localDay(opts.startEpoch ?? 0, opts.env, m);

	const dayStart = (m: Minutes): Minutes => {
		const d = daysOf();
		const i = firstAtOrAfter(d.key, d.n, dayKey(m), false);
		return i < d.n ? (d.start[i] as number) : m;
	};
	const dayEnd = (m: Minutes): Minutes => {
		const d = daysOf();
		const i = lastAtOrBefore(d.key, d.n, dayKey(m - 1), false);
		return i >= 0 ? (d.end[i] as number) : m;
	};
	const shiftDays = (m: Minutes, by: number, role: DayRole): Minutes => {
		const d = daysOf();
		if (d.n === 0) return m;
		const at =
			role === 'start'
				? firstAtOrAfter(d.key, d.n, dayKey(m), false)
				: lastAtOrBefore(d.key, d.n, dayKey(m - 1), false);
		const i = Math.max(0, Math.min(d.n - 1, at + Math.trunc(by)));
		return (role === 'start' ? d.start[i] : d.end[i]) as number;
	};

	return {
		resolution: opts.resolution,
		frameEnd,
		total,
		isWorking,
		workingBetween: (a, b) => cumAt(b) - cumAt(a),
		addWorking,
		snap,
		dayStart,
		dayEnd,
		shiftDays,
	};
}

/** The project's working time. `zones` is needed for working days in a zone other than UTC. */
export function workingTimeOf(p: ProjectInfo, zones?: ZoneOffsets): WorkingTime {
	const startMs = Date.parse(p.start);
	return workingTimeFromPairs(Array.isArray(p.workingTime) ? p.workingTime : [], {
		resolution: p.timingResolutionMin,
		frameEnd: Math.round((Date.parse(p.end) - startMs) / MINUTE_MS),
		startEpoch: Math.round(startMs / 1000),
		env: { zone: p.timezone, ...(zones ? { zones } : {}) },
	});
}

/** The local civil day (days since 1970-01-01) of a minute; UTC without zone data. */
function localDay(startEpoch: number, env: ZoneEnv | undefined, m: Minutes): number {
	const epoch = startEpoch + m * 60;
	const f = (env ? epochToLocal(epoch, env) : null) ?? fieldsFromUtc(epoch);
	return daysFromCivil(f.year, f.month, f.day);
}

/** Minutes of local midnight at the start of a civil day; UTC midnight without zone data. */
function midnight(startEpoch: number, env: ZoneEnv, day: number): Minutes {
	const { year, month, day: d } = civilFromDays(day);
	const f = { year, month, day: d, hour: 0, minute: 0, second: 0 };
	const epoch = localToEpoch(f, env) ?? Date.UTC(year, month - 1, d) / 1000;
	return Math.round((epoch - startEpoch) / 60);
}

/** Groups the pairs into local working days, splitting a pair that runs past midnight. */
function buildDays(
	starts: Float64Array,
	ends: Float64Array,
	n: number,
	startEpoch: number,
	env: ZoneEnv,
): Days {
	const key: number[] = [];
	const start: number[] = [];
	const end: number[] = [];
	const put = (k: number, a: number, b: number): void => {
		const last = key.length - 1;
		if (last >= 0 && key[last] === k) end[last] = b;
		else {
			key.push(k);
			start.push(a);
			end.push(b);
		}
	};
	for (let i = 0; i < n; i++) {
		let a = starts[i] as number;
		const b = ends[i] as number;
		while (a < b) {
			const k = localDay(startEpoch, env, a);
			const next = midnight(startEpoch, env, k + 1);
			// A zone whose midnight is missing could stall the walk: always move forward.
			const cut = next > a ? Math.min(b, next) : b;
			put(k, a, cut);
			a = cut;
		}
	}
	return {
		n: key.length,
		key: Float64Array.from(key),
		start: Float64Array.from(start),
		end: Float64Array.from(end),
	};
}

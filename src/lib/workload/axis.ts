// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's columns (phase-3.md 6.2, `BucketAxis` in types.ts): local days, weeks or months of
 * the plan's time zone over the project frame.
 *
 * - Every bound but the last is a local midnight in the project zone (`ProjectInfo.timezone`,
 *   UTC when unset), read with `localToEpoch`, the rule the browser engine uses for local dates
 *   (src/lib/tjp/values/civil.ts). So a day across a clock change is 23 or 25 hours long, and a
 *   Berlin week is 167 or 169 hours, as TaskJuggler's own calendar is.
 * - Weeks start on Monday, or on Sunday when `ProjectInfo.weekStartsMonday` is false, so they are
 *   the weeks of TaskJuggler's weekly report (`TjTime#beginOfWeek`, then `#sameTimeNextWeek`:
 *   local midnight seven calendar days on). Months start on the 1st (`#beginOfMonth`).
 * - The first bound is the start of the bucket that holds the frame start, so it is at or before 0;
 *   the last bound is the frame end. The first and last buckets can therefore be partial, and
 *   their sums cover the frame part only.
 *
 * Zone lookups go through a memo keyed by the exact instant: the midnight rule reads the offset a
 * day either side of each wall-clock midnight, which for consecutive days is the next and the
 * previous midnight, so a day axis costs about one host call per day.
 */
// T9: TaskJuggler's `beginOfWeek(true)` on a Sunday subtracts -1 days and returns the next
// Monday (TjTime.rb:207-218), so a weekly report of a frame that starts on a Sunday leaves that
// Sunday out. The axis does not copy the quirk: the Sunday belongs to the week of the Monday
// before, so every frame minute is in a bucket. Every later week is TaskJuggler's.
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
import type { BucketAxis, BucketAxisFn, BucketKind } from './types';

const MINUTE_MS = 60_000;

/** The frame end in minutes since the project start. */
export function frameEndOf(p: ProjectInfo): Minutes {
	return Math.round((Date.parse(p.end) - Date.parse(p.start)) / MINUTE_MS);
}

/** Zone offsets of one zone memoized by exact instant, for one axis build. */
function memo(zones: ZoneOffsets, only: string | null): ZoneOffsets {
	const cache = new Map<number, number>();
	return {
		valid: (zone) => zones.valid(zone),
		offset(zone, epoch) {
			if (zone !== only) return zones.offset(zone, epoch);
			let v = cache.get(epoch);
			if (v === undefined) {
				v = zones.offset(zone, epoch);
				cache.set(epoch, v);
			}
			return v;
		},
	};
}

/** Weekday of a day number (days since 1970-01-01), 0 = Sunday. */
function weekday(day: number): number {
	return (((day + 4) % 7) + 7) % 7;
}

class Axis implements BucketAxis {
	readonly count: number;
	constructor(
		readonly kind: BucketKind,
		readonly bounds: Int32Array,
	) {
		this.count = bounds.length - 1;
	}

	indexOf(m: Minutes): number {
		const b = this.bounds;
		const n = this.count;
		if (n <= 0 || m < 0 || m >= (b[n] as number)) return -1;
		let lo = 0;
		let hi = n - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >>> 1;
			if ((b[mid] as number) <= m) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}
}

/** An axis with no buckets (no project, or an empty frame). */
export function emptyAxis(kind: BucketKind): BucketAxis {
	return new Axis(kind, Int32Array.of(0));
}

export const bucketAxis: BucketAxisFn = (p, zones, kind) => {
	const end = frameEndOf(p);
	if (!(end > 0)) return emptyAxis(kind);
	const startEpoch = Date.parse(p.start) / 1000;
	const env: ZoneEnv = { zone: p.timezone, zones: memo(zones, p.timezone) };
	/** Minutes of local midnight at the start of a day number. */
	const midnight = (day: number): Minutes => {
		const { year, month, day: d } = civilFromDays(day);
		const f = { year, month, day: d, hour: 0, minute: 0, second: 0 };
		const epoch = localToEpoch(f, env) ?? daysFromCivil(year, month, d) * 86400;
		return Math.round((epoch - startEpoch) / 60);
	};
	const local = epochToLocal(startEpoch, env) ?? fieldsFromUtc(startEpoch);
	let day = daysFromCivil(local.year, local.month, local.day);
	// A midnight read past the start (a clock change at midnight) belongs to the day before.
	while (midnight(day) > 0) day--;
	if (kind === 'week') day -= (weekday(day) - (p.weekStartsMonday ? 1 : 0) + 7) % 7;
	if (kind === 'month') {
		const c = civilFromDays(day);
		day = daysFromCivil(c.year, c.month, 1);
	}
	const next = (d: number): number => {
		if (kind === 'day') return d + 1;
		if (kind === 'week') return d + 7;
		const c = civilFromDays(d);
		return c.month === 12 ? daysFromCivil(c.year + 1, 1, 1) : daysFromCivil(c.year, c.month + 1, 1);
	};
	const out: number[] = [midnight(day)];
	for (;;) {
		day = next(day);
		const m = midnight(day);
		if (m >= end) break;
		if (m > (out[out.length - 1] as number)) out.push(m);
	}
	out.push(end);
	return new Axis(kind, Int32Array.from(out));
};

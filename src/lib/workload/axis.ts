// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's columns (phase-3.md 6.2, `BucketAxis` in types.ts): local days, weeks or months of
 * the plan's time zone over the project frame.
 *
 * - Every bound but the last is a local midnight in the project zone (`ProjectInfo.timezone`,
 *   UTC when unset), read with `localToEpoch`, the rule the browser engine uses for local dates
 *   (src/lib/tjp/values/civil.ts), and snapped down to the slot grid (see the T9 note). So a day
 *   across a clock change is 23 or 25 hours long, and a Berlin week is 167 or 169 hours, as
 *   TaskJuggler's own calendar is.
 * - Weeks start on Monday, or on Sunday when `ProjectInfo.weekStartsMonday` is false, so they are
 *   the weeks of TaskJuggler's weekly report (`TjTime#beginOfWeek`, then `#sameTimeNextWeek`:
 *   local midnight seven calendar days on). Months start on the 1st (`#beginOfMonth`).
 * - The first bound is the start of the bucket that holds the frame start, so it is at or before 0;
 *   the last bound is the frame end. The first and last buckets can therefore be partial, and
 *   their sums cover the frame part only.
 *
 * The midnight rule (`localToEpoch`) reads the zone's offset at the wall-clock midnight a day
 * either side, as UTC numbers: whole UTC days. `gridZones` answers those from one host call per
 * 7 days, and asks for each day of a week only when the offset at its two ends differs; every
 * other instant goes to the host. So a day axis costs about one call per week, not per day, on any
 * host: the plain Intl one or the Gantt's `memoZones`, which asks the host three times on a miss.
 * Axes are kept per zone host, keyed by everything they read (frame, zone, week start, kind), so a
 * new result with the same frame reuses its axis. An axis is never changed after it is built, so
 * sharing it is safe.
 */
// T9: TaskJuggler's `beginOfWeek(true)` on a Sunday subtracts -1 days and returns the next
// Monday (TjTime.rb:207-218), so a weekly report of a frame that starts on a Sunday leaves that
// Sunday out. The axis does not copy the quirk: the Sunday belongs to the week of the Monday
// before, so every frame minute is in a bucket. Every later week is TaskJuggler's.
// T9: `gridZones` assumes no zone changes its offset and changes it back less than 7 days later.
// None does from 1970 to 2060: a scan of every zone in Node 22's ICU (418 zones, 25,826 changes)
// found the shortest gap between two changes of one zone to be 7 days (America/Boa_Vista,
// October 2000), which a 7-day block still sees.
// T9: bounds are snapped down to the slot grid of `timingResolutionMin`, as TaskJuggler's
// `Scoreboard#dateToIdx` truncates: a slot that holds a local midnight belongs to the bucket that
// starts there. Off the grid only where the zone's offset is not a multiple of the resolution
// (Australia/Lord_Howe's half-hour winter offset at a 60-minute resolution).
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

const DAY_S = 86400;
/** Days per block of `gridZones`. */
const BLOCK = 7;

/**
 * The host's offsets of one zone at whole UTC days from one call per block of 7 days: a day inside
 * a block whose two ends agree has their offset, else it is asked for (module comment). Other
 * instants and other zones go to the host, memoized by exact instant. For one axis build.
 */
export function gridZones(zones: ZoneOffsets, only: string | null): ZoneOffsets {
	const exact = new Map<number, number>();
	const ask = (zone: string, epoch: number): number => {
		let v = exact.get(epoch);
		if (v === undefined) exact.set(epoch, (v = zones.offset(zone, epoch)));
		return v;
	};
	return {
		valid: (zone) => zones.valid(zone),
		offset(zone, epoch) {
			if (zone !== only) return zones.offset(zone, epoch);
			if (epoch % DAY_S !== 0) return ask(zone, epoch);
			const day = epoch / DAY_S;
			const first = Math.floor(day / BLOCK) * BLOCK;
			const a = ask(zone, first * DAY_S);
			if (day === first) return a;
			return a === ask(zone, (first + BLOCK) * DAY_S) ? a : ask(zone, epoch);
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

/** Axes already built, per zone host: a result rarely changes the frame, the zone or the week. */
const built = new WeakMap<ZoneOffsets, Map<string, BucketAxis>>();
const MAX_KEPT = 12;

export const bucketAxis: BucketAxisFn = (p, zones, kind) => {
	const key = `${kind}|${p.start}|${p.end}|${p.timezone ?? ''}|${p.weekStartsMonday}`;
	let kept = built.get(zones);
	if (!kept) built.set(zones, (kept = new Map()));
	let axis = kept.get(key);
	if (!axis) {
		if (kept.size >= MAX_KEPT) kept.clear();
		kept.set(key, (axis = buildAxis(p, zones, kind)));
	}
	return axis;
};

function buildAxis(p: ProjectInfo, zones: ZoneOffsets, kind: BucketKind): BucketAxis {
	const end = frameEndOf(p);
	if (!(end > 0)) return emptyAxis(kind);
	const startEpoch = Date.parse(p.start) / 1000;
	const env: ZoneEnv = { zone: p.timezone, zones: gridZones(zones, p.timezone) };
	const res = p.timingResolutionMin;
	/** Minutes of local midnight at the start of a day number. */
	const midnight = (day: number): Minutes => {
		const { year, month, day: d } = civilFromDays(day);
		const f = { year, month, day: d, hour: 0, minute: 0, second: 0 };
		const epoch = localToEpoch(f, env) ?? daysFromCivil(year, month, d) * DAY_S;
		return Math.round((epoch - startEpoch) / 60);
	};
	const snap = (m: Minutes): Minutes => (res > 0 ? Math.floor(m / res) * res : m);
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
	const out: number[] = [snap(midnight(day))];
	for (;;) {
		day = next(day);
		const m = snap(midnight(day));
		if (m >= end) break;
		if (m > (out[out.length - 1] as number)) out.push(m);
	}
	out.push(end);
	// The first bucket is the one that holds minute 0, which a snap can move to the next one.
	while (out.length > 2 && (out[1] as number) <= 0) out.shift();
	return new Axis(kind, Int32Array.from(out));
}

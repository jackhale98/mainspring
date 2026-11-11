// SPDX-License-Identifier: GPL-2.0-only
// Close translation of TjTime#sameTimeNextDay, #lastDayOfMonth, #leapYear? and
// Project.maxScheduleGranularity (TaskJuggler 3.8.4).
/**
 * Calendar arithmetic on plain integers (no `Date`), and local time the way the browser engine
 * reads it.
 *
 * TaskJuggler reads a date without a zone with `Time.mktime` in the zone set by the last
 * project-level `timezone` statement parsed so far, and UTC before any (TaskJuggler.rb:40,
 * TjTime.rb:523-525, `rule_timezone` at TjpSyntaxRules.rb:7135-7139 calls TjTime.setTimeZone).
 * The `timezone` attributes of reports, shifts and exports do not change how dates are read.
 *
 * In the browser engine `Time.local` is the bridge's patch (`TJWasmTZ.local_to_utc`,
 * engine/bridge/wasm/tj_wasm_tz.rb:111-125, called at :135-141), which resolves DST edges as
 * native Ruby does: with `wall = Time.utc(fields)`, take the offsets one day either side,
 * `before = offset(zone, wall - 1 d)` and `after = offset(zone, wall + 1 d)`. Equal, the instant
 * is `wall - before`. Otherwise it is `wall - after` if that instant has offset `after` (the
 * unique time after a change, or the later of the two in an overlap), else `wall - before` (the
 * unique time before a change, or a gap time read with the offset before the change, so New
 * York 2026-03-08 02:30 is 07:30Z). `localToEpoch` does exactly that, with the same host
 * interface (`TimeZoneHost` in src/engine/runtime.ts satisfies `ZoneOffsets`), and
 * engine/golden/tz-edge-cases.json is its shared test table.
 *
 * `Time.utc` rolls a day past the month's end into the next month (2026-02-30 is 2026-03-02), and
 * `daysFromCivil` does the same. `daysFromCivil` and `civilFromDays` are H. Hinnant's
 * public-domain algorithms.
 */
import { fail, ok, type Result } from './result';

export interface CivilFields {
	readonly year: number;
	readonly month: number;
	readonly day: number;
	readonly hour: number;
	readonly minute: number;
	readonly second: number;
}

/** Time-zone data (the engine's `TimeZoneHost` in src/engine/runtime.ts fits). */
export interface ZoneOffsets {
	/** UTC offset in seconds of an IANA zone at a UTC instant (epoch seconds). */
	offset(zone: string, epochSeconds: number): number;
	/** Whether the zone name is known. */
	valid(zone: string): boolean;
}

/** The zone dates are read in: null and 'UTC' are UTC; anything else needs `zones`. */
export interface ZoneEnv {
	readonly zone: string | null;
	readonly zones?: ZoneOffsets;
}

const DAY = 86400;
const MON_MAX = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isLeapYear(year: number): boolean {
	return year % 400 === 0 ? true : year % 100 === 0 ? false : year % 4 === 0;
}

export function lastDayOfMonth(month: number, year: number): number {
	return month === 2 && isLeapYear(year) ? 29 : (MON_MAX[month] ?? 31);
}

/** Days since 1970-01-01 of year-month-day; `day` may run past the month's end. */
export function daysFromCivil(year: number, month: number, day: number): number {
	const y = month <= 2 ? year - 1 : year;
	const era = Math.floor(y / 400);
	const yoe = y - era * 400;
	const mp = (month + 9) % 12;
	const doy = Math.floor((153 * mp + 2) / 5);
	const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
	return era * 146097 + doe - 719468 + (day - 1);
}

export function civilFromDays(days: number): { year: number; month: number; day: number } {
	const z = days + 719468;
	const era = Math.floor(z / 146097);
	const doe = z - era * 146097;
	const yoe = Math.floor(
		(doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
	);
	const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
	const mp = Math.floor((5 * doy + 2) / 153);
	const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
	const month = mp < 10 ? mp + 3 : mp - 9;
	return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** `Time.utc(fields).to_i`. */
export function utcSeconds(f: CivilFields): number {
	return daysFromCivil(f.year, f.month, f.day) * DAY + f.hour * 3600 + f.minute * 60 + f.second;
}

export function fieldsFromUtc(epoch: number): CivilFields {
	const days = Math.floor(epoch / DAY);
	const rest = epoch - days * DAY;
	const { year, month, day } = civilFromDays(days);
	return {
		year,
		month,
		day,
		hour: Math.floor(rest / 3600),
		minute: Math.floor((rest % 3600) / 60),
		second: rest % 60,
	};
}

/** 0 = Sunday, as TaskJuggler numbers weekdays. */
export function weekdayOf(epoch: number): number {
	return (((Math.floor(epoch / DAY) + 4) % 7) + 7) % 7;
}

function zoneOf(env: ZoneEnv): string | null {
	return env.zone === null || env.zone === '' || env.zone === 'UTC' ? null : env.zone;
}

/**
 * TaskJuggler's zone-name check as the browser engine runs it (TjTime.checkTimeZone, replaced by
 * engine/bridge/wasm/tj_wasm_tz.rb:167-173): 'UTC', or a name with a '/' the zone data knows.
 */
export function checkZoneName(name: string, zones?: ZoneOffsets): Result<string> {
	if (name === 'UTC') return ok(name);
	if (!name.includes('/')) return fail('bad-zone', 0, 0, 'bad_time_zone', { zone: name });
	if (!zones) return fail('zone-data', 0, 0, null, { zone: name });
	return zones.valid(name) ? ok(name) : fail('bad-zone', 0, 0, 'bad_time_zone', { zone: name });
}

/** Offset of the env's zone at a UTC instant; null if the zone needs data that is missing. */
export function offsetAt(env: ZoneEnv, epoch: number): number | null {
	const zone = zoneOf(env);
	if (zone === null) return 0;
	return env.zones ? env.zones.offset(zone, epoch) : null;
}

/**
 * `Time.mktime(fields)` in the env's zone (`local_to_utc` in the bridge patch, see the module
 * comment): a gap time is read with the offset before the change, an overlap time is the later
 * instant. Null without zone data.
 */
export function localToEpoch(f: CivilFields, env: ZoneEnv): number | null {
	const wall = utcSeconds(f);
	const zone = zoneOf(env);
	if (zone === null) return wall;
	const zones = env.zones;
	if (!zones) return null;
	const before = zones.offset(zone, wall - DAY);
	const after = zones.offset(zone, wall + DAY);
	if (before === after) return wall - before;
	if (zones.offset(zone, wall - after) === after) return wall - after;
	return wall - before;
}

/** 2000-01-01T00:00:00Z, the instant Project.maxScheduleGranularity reads. */
const Y2000 = 946684800;

/**
 * `Project.maxScheduleGranularity` (Project.rb:1017-1035) in seconds: the largest timing
 * resolution TaskJuggler accepts in the env's zone. It reads the minutes of the zone's local time
 * at 2000-01-01T00:00Z (`Time#getlocal`, routed by engine/bridge/wasm/tj_wasm_tz.rb:153-164): 0
 * gives 3600, 30 gives 1800, 15 or 45 give 900. A zone in summer time on that date gets the
 * summer offset's cap (Australia/Lord_Howe, +11:00, gets 3600). Null without zone data or for an
 * offset TaskJuggler refuses ("Unknown Time zone alignment").
 */
export function maxScheduleGranularity(env: ZoneEnv): number | null {
	const off = offsetAt(env, Y2000);
	if (off === null) return null;
	const min = fieldsFromUtc(Y2000 + off).minute;
	return min === 0 ? 3600 : min === 30 ? 1800 : min === 15 || min === 45 ? 900 : null;
}

/**
 * Every instant whose local time in the env's zone is `f`, ascending: none in a gap, two in an
 * overlap. Null without zone data. Offsets are sampled 15 h either side, which finds any single
 * transition near `f` (two transitions within 15 h are not seen).
 */
export function localInstants(f: CivilFields, env: ZoneEnv): number[] | null {
	const base = utcSeconds(f);
	const zone = zoneOf(env);
	if (zone === null) return [base];
	const zones = env.zones;
	if (!zones) return null;
	const offsets = new Set(
		[base - 15 * 3600, base, base + 15 * 3600].map((e) => zones.offset(zone, e)),
	);
	const out = [...offsets].map((o) => base - o).filter((e) => zones.offset(zone, e) === base - e);
	return [...new Set(out)].sort((a, b) => a - b);
}

/** `Time#localtime` fields in the env's zone; null without zone data. */
export function epochToLocal(epoch: number, env: ZoneEnv): CivilFields | null {
	const off = offsetAt(env, epoch);
	return off === null ? null : fieldsFromUtc(epoch + off);
}

/** `TjTime#sameTimeNextDay` (TjTime.rb:257-267): the next calendar day, same wall time. */
export function sameTimeNextDay(epoch: number, env: ZoneEnv): number | null {
	const l = epochToLocal(epoch, env);
	if (l === null) return null;
	let { year, month, day } = l;
	if (++day > lastDayOfMonth(month, year)) {
		day = 1;
		if (++month > 12) {
			month = 1;
			year++;
		}
	}
	return localToEpoch({ ...l, year, month, day }, env);
}

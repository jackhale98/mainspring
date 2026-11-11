// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Calendar arithmetic on plain integers (no `Date`), and local time the way the browser engine
 * reads it.
 *
 * TaskJuggler reads a date without a zone with `Time.mktime` in the zone set by the last
 * `timezone` statement parsed so far, and UTC before any (TaskJuggler.rb:40, TjTime.rb:523-525,
 * TjpSyntaxRules.rb:7135-7139). In the browser engine `Time.local` is the bridge's patch
 * (engine/bridge/wasm/tj_wasm_tz.rb:46-56): `base = Time.utc(fields)`, then the offset is looked
 * up twice, `off = offset(zone, base)` and `off = offset(zone, base - off)`, and the instant is
 * `base - off`. `localToEpoch` does exactly that, with the same host interface
 * (`TimeZoneHost` in src/engine/runtime.ts satisfies `ZoneOffsets`).
 *
 * `Time.utc` rolls a day past the month's end into the next month (2026-02-30 is 2026-03-02), and
 * `daysFromCivil` does the same.
 */

export interface CivilFields {
	readonly year: number;
	readonly month: number;
	readonly day: number;
	readonly hour: number;
	readonly minute: number;
	readonly second: number;
}

/** UTC offset in seconds of an IANA zone at a UTC instant (epoch seconds). */
export interface ZoneOffsets {
	offset(zone: string, epochSeconds: number): number;
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

/** Offset of the env's zone at a UTC instant; null if the zone needs data that is missing. */
export function offsetAt(env: ZoneEnv, epoch: number): number | null {
	const zone = zoneOf(env);
	if (zone === null) return 0;
	return env.zones ? env.zones.offset(zone, epoch) : null;
}

/** `Time.mktime(fields)` in the env's zone (bridge patch algorithm); null without zone data. */
export function localToEpoch(f: CivilFields, env: ZoneEnv): number | null {
	const base = utcSeconds(f);
	const zone = zoneOf(env);
	if (zone === null) return base;
	if (!env.zones) return null;
	let off = env.zones.offset(zone, base);
	off = env.zones.offset(zone, base - off);
	return base - off;
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

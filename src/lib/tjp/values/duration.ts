// SPDX-License-Identifier: GPL-2.0-only
// Close translation of the duration rules of TjpSyntaxRules.rb (TaskJuggler 3.8.4).
/**
 * Durations: `number durationUnit`, unit `min | h | d | w | m | y` (TjpSyntaxRules.rb:1000-1018).
 * `5d` lexes as INTEGER `5` and ID `d`, so `5 d` is the same value.
 *
 * One syntax, three meanings, depending on the keyword:
 * - working time (`effort`, `length`, `gaplength`; TjpSyntaxRules.rb:7667-7684): d, w, m and y
 *   scale with `dailyworkinghours`, the weekly working days and `yearlyworkingdays`, and the
 *   result is rounded to timing slots;
 * - calendar time (`duration`; TjpSyntaxRules.rb:562-573): d = 24 h, w = 7 d, m = 30.4167 d,
 *   y = 365 d, truncated to slots;
 * - interval durations (`gapduration`, `%{date + d}`, `start +d`; TjpSyntaxRules.rb:2038-2068):
 *   seconds, never 0, months rounded down to the resolution, and a multiple of it.
 * All arithmetic follows Ruby's Integer/Float rules (see number.ts).
 */
import { maxScheduleGranularity, type ZoneEnv } from './civil';
import type { ProjectContext } from './context';
import { parseWith, type Cursor } from './cursor';
import {
	float,
	int,
	printNumber,
	rDiv,
	readInteger,
	readNumber,
	rMul,
	rRound,
	rToI,
	sameNumber,
	type TjNumber,
} from './number';
import { fail, ok, raise, type Parsed, type Result } from './result';

export const DURATION_UNITS = ['min', 'h', 'd', 'w', 'm', 'y'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export interface Duration {
	readonly amount: TjNumber;
	readonly unit: DurationUnit;
}

const isUnit = (s: string): s is DurationUnit => (DURATION_UNITS as readonly string[]).includes(s);

export function readDuration(c: Cursor): Duration {
	const amount = readNumber(c);
	const u = c.expect('id', 'absId', 'idColon');
	if (u.kind !== 'id' || !isUnit(u.text))
		return raise('bad-unit', u.from, u.to, null, { got: u.text });
	return { amount, unit: u.text };
}

export function parseDuration(text: string, base = 0): Parsed<Duration> {
	return parseWith(text, base, readDuration);
}

export function printDuration(d: Duration): Result<string> {
	const n = printNumber(d.amount);
	return n.ok ? ok(n.value + d.unit) : n;
}

export function sameDuration(a: Duration, b: Duration): boolean {
	return a.unit === b.unit && sameNumber(a.amount, b.amount);
}

/** Working time in timing slots (`workingDuration`, rounded as Ruby rounds). */
export function workingSlots(d: Duration, ctx: ProjectContext): number {
	const dwh = ctx.dailyWorkingHours;
	const day = rMul(int(3600), dwh);
	let factor: TjNumber;
	switch (d.unit) {
		case 'min':
			factor = int(60);
			break;
		case 'h':
			factor = int(3600);
			break;
		case 'd':
			factor = day;
			break;
		case 'w':
			factor = rMul(day, rDiv(int(ctx.weeklyWorkingHours), dwh));
			break;
		case 'm':
			factor = rMul(day, rDiv(ctx.yearlyWorkingDays, int(12)));
			break;
		case 'y':
			factor = rMul(day, ctx.yearlyWorkingDays);
			break;
	}
	return rRound(rDiv(rMul(d.amount, factor), int(ctx.granularity)));
}

const CALENDAR_SECONDS: Readonly<Record<DurationUnit, number>> = {
	min: 60.0,
	h: 60.0 * 60,
	d: 60.0 * 60 * 24,
	w: 60.0 * 60 * 24 * 7,
	m: 60.0 * 60 * 24 * 30.4167,
	y: 60.0 * 60 * 24 * 365,
};

/** Calendar time in timing slots (`calendarDuration`, truncated). */
export function calendarSlots(d: Duration, ctx: ProjectContext): number {
	return rToI(float((d.amount.value * CALENDAR_SECONDS[d.unit]) / ctx.granularity));
}

const INTERVAL_SECONDS: Readonly<Record<DurationUnit, TjNumber>> = {
	min: int(60),
	h: int(60 * 60),
	d: int(60 * 60 * 24),
	w: int(60 * 60 * 24 * 7),
	m: float(60 * 60 * 24 * 30.4167),
	y: int(60 * 60 * 24 * 365),
};

/** An interval duration in seconds (`intervalDuration`), with TaskJuggler's two errors. */
export function intervalSeconds(d: Duration, ctx: ProjectContext): Result<number> {
	if (d.amount.value === 0) return fail('zero-duration', 0, 0, 'zero_duration');
	let seconds = rToI(rMul(d.amount, INTERVAL_SECONDS[d.unit]));
	const res = ctx.granularity;
	if (d.unit === 'm') seconds = Math.floor(seconds / res) * res;
	if (seconds % res !== 0) {
		return fail('duration-not-aligned', 0, 0, 'iv_duration_not_aligned', { resolution: res / 60 });
	}
	return ok(seconds);
}

/** How a keyword reads its duration. */
export type DurationUse = 'effort' | 'length' | 'gaplength' | 'duration' | 'gapduration';

/**
 * The amount TaskJuggler stores for `use`: slots for effort, length, gaplength and duration;
 * seconds for gapduration. Fails where TaskJuggler reports an error.
 */
export function durationAmount(d: Duration, use: DurationUse, ctx: ProjectContext): Result<number> {
	switch (use) {
		case 'duration':
			return ok(calendarSlots(d, ctx));
		case 'gapduration':
			return intervalSeconds(d, ctx);
		case 'effort':
		case 'length':
		case 'gaplength': {
			const slots = workingSlots(d, ctx);
			if (slots > 0) return ok(slots);
			const tj = use === 'effort' ? 'effort_zero' : 'working_duration_too_small';
			return fail('duration-too-small', 0, 0, tj, { resolution: ctx.granularity / 60 });
		}
	}
}

/** True when both durations give TaskJuggler the same amount (e.g. `1w` and `5d` of effort). */
export function equivalentDurations(
	a: Duration,
	b: Duration,
	use: DurationUse,
	ctx: ProjectContext,
): boolean {
	if (sameDuration(a, b)) return true;
	const x = durationAmount(a, use, ctx);
	const y = durationAmount(b, use, ctx);
	return x.ok && y.ok && x.value === y.value;
}

/** The values `timingresolution` accepts (TjpSyntaxRules.rb:3332-3345). */
export const TIMING_RESOLUTIONS = [5, 10, 15, 20, 30, 60] as const;

/**
 * `timingresolution <INTEGER> min`: the minutes (the text after the keyword). Any integer
 * parses; `checkTimingResolution` applies `bad_timing_res` and `too_large_timing_res`.
 */
export function parseTimingResolution(text: string, base = 0): Parsed<number> {
	return parseWith(text, base, (c) => {
		const n = readInteger(c);
		const u = c.expect('id', 'absId', 'idColon');
		if (u.text !== 'min') raise('bad-unit', u.from, u.to, null, { got: u.text });
		return n;
	});
}

export function printTimingResolution(minutes: number): Result<string> {
	return checkTimingResolution(minutes).ok ? ok(`${minutes}min`) : fail('unrepresentable', 0, 0);
}

/**
 * TaskJuggler's own checks (TjpSyntaxRules.rb:3332-3345): one of TIMING_RESOLUTIONS
 * (`bad_timing_res`), and, given the zone in force (`env`), at most the zone's cap,
 * `Project.maxScheduleGranularity` (`too_large_timing_res`: 15 min for Asia/Kathmandu, 30 for
 * Asia/Kolkata). Without `env` only the first check runs; a zone without zone data fails with
 * `zone-data`.
 */
export function checkTimingResolution(minutes: number, env?: ZoneEnv): Result<number> {
	if (!(TIMING_RESOLUTIONS as readonly number[]).includes(minutes)) {
		return fail('number-range', 0, 0, 'bad_timing_res', { got: minutes });
	}
	if (!env) return ok(minutes);
	const cap = maxScheduleGranularity(env);
	if (cap === null) return fail('zone-data', 0, 0, null, { zone: env.zone ?? '' });
	if (minutes * 60 > cap) {
		return fail('number-range', 0, 0, 'too_large_timing_res', { got: minutes, max: cap / 60 });
	}
	return ok(minutes);
}

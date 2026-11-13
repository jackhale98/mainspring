// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Durations in TaskJuggler's units (phase-2.md 6.2), from the engine's project settings, exactly
 * as `ProjectInfo.dailyWorkingHours` documents the conversion (src/engine/protocol.ts):
 *
 * - Working time (`effort`, `length`, `gaplength`; TjpSyntaxRules.rb rule_workingDuration):
 *   `slots = round(value * factor / (resolution * 60))`, factor in seconds: min 60, h 3600,
 *   d 3600 * dailyWorkingHours, w that times weeklyWorkingDays, m times monthlyWorkingDays,
 *   y times yearlyWorkingDays. The products are taken left to right in doubles. Ruby keeps an
 *   Integer value times an Integer factor an Integer and divides as integers, truncating before the
 *   rounding; with the engine's numbers that differs only for a whole number of `min` that is not
 *   a multiple of the resolution ('10min' at 15-minute resolution is 0 slots). `written: 'integer'`
 *   selects that rule (the default for a whole number).
 * - Calendar time (`duration`; rule_calendarDuration): `trunc(value * f / (resolution * 60))` with
 *   f 60, 3600, 86400, 604800, 2628002.88 and 31536000 s. Always truncated, never rounded.
 * - Interval time (`gapduration`; rule_intervalDuration): seconds, truncated; months rounded down to
 *   the resolution. TaskJuggler refuses a zero or unaligned interval, so that gives null.
 *
 * Values are minutes (slots times the resolution), as the protocol's `gapLengthMin` and
 * `gapDurationMin` are. `durationText` goes the other way for display and for edits: whole units,
 * at least 1. Text only: nothing here schedules (ADR-0007).
 *
 * Why not values/duration.ts: it converts from the plan's settings as written, Integer or Float
 * (`yearlyworkingdays 260` makes a month 21 days by Integer division, `260.0` makes it 21.67),
 * and ProjectInfo carries plain numbers with the engine's divisions already done. The tests check
 * that both give the same slots for every unit and setting.
 */
import type { ProjectInfo } from '../../engine/protocol';
import type { DurationUnit, DurationUse } from '../tjp/values/duration';

export type { DurationUnit, DurationUse };

/** The project settings a duration's meaning depends on (a subset of ProjectInfo). */
export type DurationSettings = Pick<
	ProjectInfo,
	| 'timingResolutionMin'
	| 'dailyWorkingHours'
	| 'weeklyWorkingDays'
	| 'monthlyWorkingDays'
	| 'yearlyWorkingDays'
>;

const CALENDAR_SECONDS: Readonly<Record<DurationUnit, number>> = {
	min: 60.0,
	h: 60.0 * 60,
	d: 60.0 * 60 * 24,
	w: 60.0 * 60 * 24 * 7,
	m: 60.0 * 60 * 24 * 30.4167,
	y: 60.0 * 60 * 24 * 365,
};

/** Whether a use counts working time (scaled by the working-day settings). */
export function isWorkingUse(use: DurationUse): boolean {
	return use === 'effort' || use === 'length' || use === 'gaplength';
}

/** The working factor in seconds, as rule_workingDuration builds it; null when not finite. */
function workingFactor(unit: DurationUnit, p: DurationSettings): number | null {
	const day = 60 * 60 * p.dailyWorkingHours;
	let f: number;
	switch (unit) {
		case 'min':
			return 60;
		case 'h':
			return 3600;
		case 'd':
			f = day;
			break;
		case 'w':
			if (p.weeklyWorkingDays === null) return null;
			f = day * p.weeklyWorkingDays;
			break;
		case 'm':
			f = day * p.monthlyWorkingDays;
			break;
		case 'y':
			f = day * p.yearlyWorkingDays;
			break;
	}
	return Number.isFinite(f) ? f : null;
}

/** Ruby's Float#round: halves away from zero. */
function rubyRound(x: number): number {
	return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * The minutes TaskJuggler stores for `value unit` under `use` (slots times the resolution), or
 * null when TaskJuggler cannot use it (a `w` with no finite weekly days, a refused gapduration).
 */
export function durationMinutes(
	value: number,
	unit: DurationUnit,
	p: DurationSettings,
	use: DurationUse,
	written: 'integer' | 'float' = Number.isInteger(value) ? 'integer' : 'float',
): number | null {
	const res = p.timingResolutionMin;
	const gran = res * 60;
	if (use === 'duration') return Math.trunc((value * CALENDAR_SECONDS[unit]) / gran) * res;
	if (use === 'gapduration') {
		if (value === 0) return null;
		// rule_intervalDuration: Integer factors except months, then truncated to whole seconds.
		let seconds = Math.trunc(value * CALENDAR_SECONDS[unit]);
		if (unit === 'm') seconds = Math.floor(seconds / gran) * gran;
		return seconds % gran === 0 ? seconds / 60 : null;
	}
	const factor = workingFactor(unit, p);
	if (factor === null) return null;
	if (written === 'integer' && unit === 'min') return Math.floor((value * 60) / gran) * res;
	return rubyRound((value * factor) / gran) * res;
}

/**
 * Minutes in one unit, unrounded: what `durationText` divides by. Null for a unit TaskJuggler
 * cannot use with these settings, or one that is not positive (`dailyworkinghours 0`).
 */
export function unitMinutes(
	unit: DurationUnit,
	p: DurationSettings,
	use: DurationUse,
): number | null {
	if (!isWorkingUse(use)) return CALENDAR_SECONDS[unit] / 60;
	const f = workingFactor(unit, p);
	return f !== null && f > 0 ? f / 60 : null;
}

/**
 * Duration text in a unit, rounded to whole units, at least 1: ('d', 2880 working min) gives '6d'
 * at 8 h a day. Whole minutes are rounded to the timing resolution, since TaskJuggler truncates
 * the rest away ('20min' at 15-minute resolution means 15). A unit the settings cannot express
 * (a `w` without weekly days, a day of 0 hours) falls back to hours.
 */
export function durationText(
	min: number,
	unit: DurationUnit,
	p: DurationSettings,
	use: DurationUse = 'effort',
): string {
	const per = unitMinutes(unit, p, use);
	if (per === null) return durationText(min, 'h', p, use);
	if (unit === 'min') {
		const res = p.timingResolutionMin;
		return `${Math.max(1, Math.round(min / res)) * res}min`;
	}
	return `${Math.max(1, Math.round(min / per))}${unit}`;
}

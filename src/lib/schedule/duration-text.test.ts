// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { projectContext } from '../tjp/values/context';
import {
	DURATION_UNITS,
	calendarSlots,
	intervalSeconds,
	workingSlots,
	type DurationUnit,
} from '../tjp/values/duration';
import { float, int, rDiv, type TjNumber } from '../tjp/values/number';
import {
	durationMinutes,
	durationText,
	isWorkingUse,
	unitMinutes,
	type DurationSettings,
} from './duration-text';
import { project } from './testing';

const DEFAULT: DurationSettings = project();
const at = (over: Partial<DurationSettings>): DurationSettings => ({ ...DEFAULT, ...over });

describe('durationMinutes (the protocol conversion)', () => {
	it('converts working units with the working-day settings', () => {
		expect(durationMinutes(5, 'd', DEFAULT, 'effort')).toBe(5 * 480);
		expect(durationMinutes(1, 'w', DEFAULT, 'length')).toBe(5 * 480);
		expect(durationMinutes(2, 'h', DEFAULT, 'gaplength')).toBe(120);
		// 260.714 / 12 working days of 8 h, rounded to whole slots.
		expect(durationMinutes(1, 'm', DEFAULT, 'effort')).toBe(Math.round((260.714 / 12) * 8) * 60);
		expect(durationMinutes(1, 'y', DEFAULT, 'effort')).toBe(Math.round(260.714 * 8) * 60);
	});

	it('rounds working time to slots as Ruby does: halves away from zero', () => {
		// dailyworkinghours 7.5: one day is 7.5 one-hour slots, which rounds to 8.
		expect(durationMinutes(1, 'd', at({ dailyWorkingHours: 7.5 }), 'effort')).toBe(480);
		expect(durationMinutes(2, 'd', at({ dailyWorkingHours: 7.5 }), 'effort')).toBe(900);
	});

	it('truncates a whole number of minutes, as Ruby divides two Integers', () => {
		const q = at({ timingResolutionMin: 15 });
		expect(durationMinutes(10, 'min', q, 'effort')).toBe(0);
		expect(durationMinutes(10, 'min', q, 'effort', 'float')).toBe(15);
		expect(durationMinutes(10.5, 'min', q, 'effort')).toBe(15);
		expect(durationMinutes(40, 'min', q, 'effort')).toBe(30);
	});

	it('counts duration in calendar time, always truncated', () => {
		expect(durationMinutes(2, 'd', DEFAULT, 'duration')).toBe(2 * 1440);
		expect(durationMinutes(1, 'w', DEFAULT, 'duration')).toBe(7 * 1440);
		// 30.4167 days is 730.0008 hours: 730 slots.
		expect(durationMinutes(1, 'm', DEFAULT, 'duration')).toBe(730 * 60);
		expect(durationMinutes(1.9, 'h', DEFAULT, 'duration')).toBe(60);
		// The working-day settings do not matter to calendar time.
		expect(durationMinutes(2, 'd', at({ dailyWorkingHours: 6 }), 'duration')).toBe(2 * 1440);
	});

	it('gives a gapduration in minutes, null where TaskJuggler refuses it', () => {
		expect(durationMinutes(3, 'd', DEFAULT, 'gapduration')).toBe(3 * 1440);
		expect(durationMinutes(10, 'min', at({ timingResolutionMin: 15 }), 'gapduration')).toBeNull();
		expect(durationMinutes(0, 'd', DEFAULT, 'gapduration')).toBeNull();
		// Months are rounded down to the resolution: 2628002 s down to 730 hours.
		expect(durationMinutes(1, 'm', DEFAULT, 'gapduration')).toBe(730 * 60);
		expect(durationMinutes(1, 'm', at({ timingResolutionMin: 5 }), 'gapduration')).toBe(43800);
	});

	it('is null for weeks when the weekly days are not finite', () => {
		expect(durationMinutes(1, 'w', at({ weeklyWorkingDays: null }), 'effort')).toBeNull();
		expect(unitMinutes('w', at({ weeklyWorkingDays: null }), 'effort')).toBeNull();
		expect(unitMinutes('d', at({ dailyWorkingHours: 0 }), 'effort')).toBeNull();
	});
});

describe('durationText', () => {
	it('writes whole units, at least 1', () => {
		expect(durationText(2880, 'd', DEFAULT)).toBe('6d');
		expect(durationText(2700, 'd', DEFAULT)).toBe('6d');
		expect(durationText(100, 'd', DEFAULT)).toBe('1d');
		expect(durationText(0, 'h', DEFAULT)).toBe('1h');
		expect(durationText(4800, 'w', DEFAULT, 'length')).toBe('2w');
	});

	it('uses calendar units for duration and gapduration', () => {
		expect(durationText(2880, 'd', DEFAULT, 'duration')).toBe('2d');
		expect(durationText(3 * 1440, 'd', DEFAULT, 'gapduration')).toBe('3d');
		expect(durationText(2880, 'd', DEFAULT, 'effort')).toBe('6d');
	});

	it('rounds minutes to the timing resolution', () => {
		const q = at({ timingResolutionMin: 15 });
		expect(durationText(20, 'min', q)).toBe('15min');
		expect(durationText(5, 'min', q)).toBe('15min');
		expect(durationText(38, 'min', q)).toBe('45min');
	});

	it('falls back to hours for a unit the settings cannot express', () => {
		expect(durationText(960, 'w', at({ weeklyWorkingDays: null }))).toBe('16h');
	});

	it('round-trips whole units through the conversion', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 400 }),
				fc.constantFrom<DurationUnit>('h', 'd', 'w', 'm', 'y'),
				fc.constantFrom('effort', 'length', 'duration', 'gapduration') as fc.Arbitrary<
					'effort' | 'length' | 'duration' | 'gapduration'
				>,
				fc.constantFrom(5, 10, 15, 20, 30, 60),
				fc.constantFrom(8, 7.5, 6),
				(k, unit, use, res, dwh) => {
					const p = at({ timingResolutionMin: res, dailyWorkingHours: dwh });
					const per = unitMinutes(unit, p, use);
					const stored = durationMinutes(k, unit, p, use);
					if (per === null || stored === null || per < 2 * res) return true;
					return durationText(stored, unit, p, use) === `${k}${unit}`;
				},
			),
			{ seed: 20261113, numRuns: 2000 },
		);
	});
});

/**
 * The protocol's numbers as the bridge computes them from the plan's settings (Project.rb):
 * weekly days are the weekly whole hours over `dailyworkinghours`, monthly days `yearly / 12`,
 * both with Ruby's Integer division when both sides are Integers.
 */
function settingsOf(dwh: TjNumber, ywd: TjNumber, wwh: number, res: number): DurationSettings {
	return {
		timingResolutionMin: res,
		dailyWorkingHours: dwh.value,
		weeklyWorkingDays: rDiv(int(wwh), dwh).value,
		monthlyWorkingDays: rDiv(ywd, int(12)).value,
		yearlyWorkingDays: ywd.value,
	};
}

describe('agreement with the Ruby-faithful conversion in values/duration.ts', () => {
	const dwhs = [int(8), float(8), float(7.5), int(6), float(0.5)];
	const ywds = [float(260.714), int(260), float(250.5)];
	const amount = fc.oneof(
		fc.integer({ min: 0, max: 600 }).map(int),
		fc.integer({ min: 0, max: 6000 }).map((n) => float(n / 10)),
	);
	const settings = fc.record({
		dwh: fc.constantFrom(...dwhs),
		ywd: fc.constantFrom(...ywds),
		wwh: fc.constantFrom(40, 37, 20),
		res: fc.constantFrom(5, 10, 15, 20, 30, 60),
	});

	it('gives the same slots for every working unit and setting', () => {
		fc.assert(
			fc.property(amount, fc.constantFrom(...DURATION_UNITS), settings, (a, unit, s) => {
				const ctx = projectContext({
					dailyWorkingHours: s.dwh,
					yearlyWorkingDays: s.ywd,
					weeklyWorkingHours: s.wwh,
					granularity: s.res * 60,
				});
				const p = settingsOf(s.dwh, s.ywd, s.wwh, s.res);
				const got = durationMinutes(a.value, unit, p, 'effort', a.float ? 'float' : 'integer');
				return got === workingSlots({ amount: a, unit }, ctx) * s.res;
			}),
			{ seed: 20261113, numRuns: 5000 },
		);
	});

	it('gives the same slots for calendar and interval time', () => {
		fc.assert(
			fc.property(amount, fc.constantFrom(...DURATION_UNITS), settings, (a, unit, s) => {
				const ctx = projectContext({ granularity: s.res * 60 });
				const p = settingsOf(s.dwh, s.ywd, s.wwh, s.res);
				const cal = durationMinutes(a.value, unit, p, 'duration');
				const gap = durationMinutes(a.value, unit, p, 'gapduration');
				const iv = intervalSeconds({ amount: a, unit }, ctx);
				return (
					cal === calendarSlots({ amount: a, unit }, ctx) * s.res &&
					gap === (iv.ok ? iv.value / 60 : null)
				);
			}),
			{ seed: 20261113, numRuns: 5000 },
		);
	});

	it('knows which uses count working time', () => {
		expect(['effort', 'length', 'gaplength'].every((u) => isWorkingUse(u as 'effort'))).toBe(true);
		expect(isWorkingUse('duration') || isWorkingUse('gapduration')).toBe(false);
	});
});

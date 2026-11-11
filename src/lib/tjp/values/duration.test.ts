// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { projectContext } from './context';
import {
	calendarSlots,
	durationAmount,
	equivalentDurations,
	intervalSeconds,
	parseDuration,
	printDuration,
	workingSlots,
	type Duration,
} from './duration';
import { float, int } from './number';

const dur = (text: string): Duration => {
	const r = parseDuration(text);
	if (!r.ok) throw new Error(`${text}: ${r.error.code}`);
	return r.value;
};
const ctx = projectContext({});

describe('parseDuration', () => {
	it('reads number and unit as two tokens', () => {
		expect(dur('5d')).toEqual({ amount: int(5), unit: 'd' });
		expect(dur('5 d')).toEqual({ amount: int(5), unit: 'd' });
		expect(dur('5 # why\n d')).toEqual({ amount: int(5), unit: 'd' });
		expect(dur('1.5h')).toEqual({ amount: float(1.5), unit: 'h' });
		expect(dur('.25w')).toEqual({ amount: float(0.25), unit: 'w' });
		expect(dur('30min')).toEqual({ amount: int(30), unit: 'min' });
		for (const u of ['min', 'h', 'd', 'w', 'm', 'y']) expect(dur(`2${u}`).unit).toBe(u);
	});

	it('reports a bad unit at the unit', () => {
		expect(parseDuration('5days')).toMatchObject({
			ok: false,
			error: { code: 'bad-unit', from: 1, to: 5 },
		});
		expect(parseDuration('5 s')).toMatchObject({
			ok: false,
			error: { code: 'bad-unit', from: 2, to: 3 },
		});
		expect(parseDuration('5d.x')).toMatchObject({ ok: false, error: { code: 'bad-unit' } });
		expect(parseDuration('5')).toMatchObject({ ok: false, error: { code: 'unexpected-end' } });
		expect(parseDuration('d')).toMatchObject({ ok: false, error: { code: 'unexpected-token' } });
		expect(parseDuration('5d 1h')).toMatchObject({
			ok: false,
			error: { code: 'trailing-text', from: 3 },
		});
	});

	it('prints canonically', () => {
		expect(printDuration(dur(' 05 d '))).toEqual({ ok: true, value: '5d' });
		expect(printDuration(dur('2.0w'))).toEqual({ ok: true, value: '2.0w' });
		expect(printDuration({ amount: int(-1), unit: 'd' }).ok).toBe(false);
	});
});

describe('workingSlots (effort, length, gaplength)', () => {
	it('uses dailyworkinghours for days', () => {
		expect(workingSlots(dur('5d'), ctx)).toBe(40);
		expect(
			workingSlots(dur('5d'), projectContext({ dailyWorkingHours: float(7.5), granularity: 900 })),
		).toBe(150);
		expect(workingSlots(dur('1.25d'), projectContext({ granularity: 900 }))).toBe(40);
	});

	it('uses weekly working hours over daily hours for weeks', () => {
		expect(workingSlots(dur('1w'), ctx)).toBe(40);
		// 37 h a week and 7.5 h a day: 4.933... days a week.
		expect(
			workingSlots(
				dur('1w'),
				projectContext({ weeklyWorkingHours: 37, dailyWorkingHours: float(7.5) }),
			),
		).toBe(37);
		// With an Integer dailyworkinghours, 37 / 8 is Integer division: 4 days a week.
		expect(
			workingSlots(
				dur('1w'),
				projectContext({ weeklyWorkingHours: 37, dailyWorkingHours: int(8) }),
			),
		).toBe(32);
	});

	it('uses yearlyworkingdays for months and years', () => {
		expect(workingSlots(dur('1m'), ctx)).toBe(Math.round((8 * 260.714) / 12));
		expect(workingSlots(dur('1y'), ctx)).toBe(Math.round(8 * 260.714));
		// yearlyworkingdays 260 (Integer) / 12 = 21 days a month.
		expect(workingSlots(dur('1m'), projectContext({ yearlyWorkingDays: int(260) }))).toBe(168);
	});

	it('rounds as Ruby does, so 45min and 45.0min differ', () => {
		expect(workingSlots(dur('45min'), ctx)).toBe(0);
		expect(workingSlots(dur('45.0min'), ctx)).toBe(1);
		expect(workingSlots(dur('30.0min'), ctx)).toBe(1);
		expect(workingSlots(dur('20.0min'), ctx)).toBe(0);
	});
});

describe('calendarSlots (duration)', () => {
	it('uses calendar days and truncates', () => {
		expect(calendarSlots(dur('1d'), ctx)).toBe(24);
		expect(calendarSlots(dur('1w'), ctx)).toBe(168);
		expect(calendarSlots(dur('1m'), ctx)).toBe(Math.trunc((86400 * 30.4167) / 3600));
		expect(calendarSlots(dur('1y'), ctx)).toBe(8760);
		expect(calendarSlots(dur('59min'), ctx)).toBe(0);
		expect(calendarSlots(dur('36h'), ctx)).toBe(36);
	});
});

describe('intervalSeconds (gapduration, %{} and +duration)', () => {
	it('gives seconds', () => {
		expect(intervalSeconds(dur('2d'), ctx)).toEqual({ ok: true, value: 172800 });
		expect(intervalSeconds(dur('3w'), ctx)).toEqual({ ok: true, value: 3 * 604800 });
	});

	it('refuses zero and misaligned durations', () => {
		expect(intervalSeconds(dur('0d'), ctx)).toMatchObject({
			ok: false,
			error: { code: 'zero-duration', tj: 'zero_duration' },
		});
		expect(intervalSeconds(dur('0.0h'), ctx)).toMatchObject({
			ok: false,
			error: { code: 'zero-duration' },
		});
		expect(intervalSeconds(dur('30min'), ctx)).toMatchObject({
			ok: false,
			error: { code: 'duration-not-aligned', tj: 'iv_duration_not_aligned' },
		});
		expect(intervalSeconds(dur('30min'), projectContext({ granularity: 900 }))).toEqual({
			ok: true,
			value: 1800,
		});
	});

	it('rounds months down to the resolution', () => {
		const m = Math.trunc(86400 * 30.4167);
		expect(intervalSeconds(dur('1m'), ctx)).toEqual({
			ok: true,
			value: Math.floor(m / 3600) * 3600,
		});
		expect(intervalSeconds(dur('8m'), ctx)).toEqual({
			ok: true,
			value: Math.floor((8 * m) / 3600) * 3600,
		});
	});
});

describe('durationAmount', () => {
	it('applies the keyword checks', () => {
		expect(durationAmount(dur('5d'), 'effort', ctx)).toEqual({ ok: true, value: 40 });
		expect(durationAmount(dur('10min'), 'effort', ctx)).toMatchObject({
			ok: false,
			error: { tj: 'effort_zero' },
		});
		expect(durationAmount(dur('10min'), 'length', ctx)).toMatchObject({
			ok: false,
			error: { tj: 'working_duration_too_small' },
		});
		expect(durationAmount(dur('2d'), 'gaplength', ctx)).toEqual({ ok: true, value: 16 });
		expect(durationAmount(dur('2d'), 'duration', ctx)).toEqual({ ok: true, value: 48 });
		expect(durationAmount(dur('2d'), 'gapduration', ctx)).toEqual({ ok: true, value: 172800 });
	});

	it('compares durations by what TaskJuggler stores', () => {
		expect(equivalentDurations(dur('1w'), dur('5d'), 'effort', ctx)).toBe(true);
		expect(equivalentDurations(dur('1w'), dur('5d'), 'duration', ctx)).toBe(false);
		expect(equivalentDurations(dur('8h'), dur('1d'), 'length', ctx)).toBe(true);
	});
});

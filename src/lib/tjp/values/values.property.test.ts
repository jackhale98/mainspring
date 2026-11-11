// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Round-trip properties for every value kind (200 runs each):
 * - R1: parse(print(v)) deep-equals v for values the app creates (canonical values);
 * - R2: any other spelling of v (padding, other quotes, whitespace and comments between tokens)
 *   parses to a value equal to v, and prints as print(v), so print(parse(x)) means x;
 * - R3: parsing never throws, and error offsets stay inside the text;
 * - R4: dates the app writes for an instant resolve back to that instant, in UTC and four zones,
 *   biased toward DST and offset transitions; a date without an offset names one instant only;
 * - R5: dates and interval durations pass the resolution check exactly when they are aligned;
 * - R6: duration slots follow Ruby's Integer/Float rules, and printing keeps them.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../../engine/runtime';
import { daysFromCivil, lastDayOfMonth, localInstants } from './civil';
import { arbitraries, messy, type Variant } from './testing/arbitraries';
import {
	TIMING_RESOLUTIONS,
	calendarSlots,
	dateFromEpoch,
	float,
	int,
	intervalSeconds,
	parseValue,
	printDate,
	printValue,
	projectContext,
	resolveDate,
	sameValue,
	type TypedValue,
	workingSlots,
	type ValueKind,
} from './index';

const RUNS = { numRuns: 200 };
const KINDS = Object.keys(arbitraries) as ValueKind[];

function print(v: TypedValue): string {
	const p = printValue(v);
	if (!p.ok) throw new Error(`cannot print ${JSON.stringify(v)}: ${p.error.code}`);
	return p.value;
}

describe('R1: parse(print(v)) === v', () => {
	it.each(KINDS)('%s', (kind) => {
		fc.assert(
			fc.property(arbitraries[kind], (v) => {
				const r = parseValue(kind, print(v));
				expect(r.ok && r.value).toEqual(v);
			}),
			RUNS,
		);
	});
});

describe('R2: other spellings mean the same and print canonically', () => {
	const variant: fc.Arbitrary<Variant> = fc.record({
		seed: fc.array(fc.nat({ max: 1000 }), { minLength: 32, maxLength: 32 }),
	});
	it.each(KINDS)('%s', (kind) => {
		fc.assert(
			fc.property(arbitraries[kind], variant, (v, how) => {
				const text = messy(v, how);
				const r = parseValue(kind, text, 10);
				if (!r.ok) throw new Error(`${JSON.stringify(text)}: ${r.error.code} at ${r.error.from}`);
				expect(sameValue(r.value, v)).toBe(true);
				expect(print(r.value)).toBe(print(v));
			}),
			RUNS,
		);
	});
});

describe('R3: parsing is total', () => {
	const soup = fc.array(
		fc.constantFrom(
			'5',
			'd',
			' ',
			'\n',
			'-',
			'+',
			',',
			'"',
			"'",
			'\\',
			'%',
			'{',
			'}',
			'!',
			'.',
			':',
			'#',
			'/',
			'*',
			'2026-01-05',
			'9:00',
			'mon',
			'off',
			'holiday',
			'-8<-',
			'->8-',
			'${x}',
			'a.b',
		),
		{ maxLength: 12 },
	);
	it.each(KINDS)('%s', (kind) => {
		fc.assert(
			fc.property(
				fc.oneof(
					soup.map((p) => p.join('')),
					fc.string(),
				),
				fc.nat({ max: 100 }),
				(text, base) => {
					const r = parseValue(kind, text, base);
					if (!r.ok) {
						expect(r.error.from).toBeGreaterThanOrEqual(base);
						expect(r.error.to).toBeLessThanOrEqual(base + text.length);
						expect(r.error.from).toBeLessThanOrEqual(r.error.to);
					}
				},
			),
			RUNS,
		);
	});
});

describe('R4: dates written for an instant resolve to it', () => {
	const zones = createTimeZoneHost();
	/** DST and offset changes from 1970 to 2035: weekly steps, then bisection to the second. */
	function transitions(zone: string): number[] {
		const out: number[] = [];
		const step = 7 * 86400;
		for (
			let e = daysFromCivil(1970, 1, 1) * 86400;
			e < daysFromCivil(2035, 12, 1) * 86400;
			e += step
		) {
			if (zones.offset(zone, e) === zones.offset(zone, e + step)) continue;
			let lo = e;
			let hi = e + step;
			while (hi - lo > 1) {
				const mid = Math.floor((lo + hi) / 2);
				if (zones.offset(zone, mid) === zones.offset(zone, lo)) lo = mid;
				else hi = mid;
			}
			out.push(hi);
		}
		return out;
	}
	const uniform = fc
		.record({
			y: fc.integer({ min: 1971, max: 2034 }),
			mo: fc.integer({ min: 1, max: 12 }),
			d: fc.integer({ min: 1, max: 31 }),
			slot: fc.integer({ min: 0, max: 24 * 4 - 1 }),
		})
		.map(({ y, mo, d, slot }) => {
			const day = Math.min(d, lastDayOfMonth(mo, y));
			return daysFromCivil(y, mo, day) * 86400 + slot * 900;
		});
	const ZONES = ['Europe/Berlin', 'Asia/Kathmandu', 'America/New_York', 'Australia/Sydney'];
	for (const zone of [null, ...ZONES]) {
		it(String(zone), () => {
			const ctx = projectContext({ zone, zones, granularity: 900 });
			const near = zone === null ? [] : transitions(zone).filter((t) => t % 900 === 0);
			if (zone !== null) expect(near.length).toBeGreaterThan(0);
			// Three in four cases fall within three hours of a transition.
			const instant =
				near.length === 0
					? uniform
					: fc.oneof(
							{ weight: 1, arbitrary: uniform },
							{
								weight: 3,
								arbitrary: fc
									.tuple(fc.constantFrom(...near), fc.integer({ min: -12, max: 12 }))
									.map(([t, k]) => t + k * 900),
							},
						);
			fc.assert(
				fc.property(instant, (e) => {
					const d = dateFromEpoch(e, ctx);
					if (d === null) throw new Error(`no date for ${e}`);
					const text = printDate({ kind: 'date', date: d });
					const r = text.ok ? parseValue('date', text.value) : null;
					if (!r?.ok || r.value.kind !== 'date') throw new Error('no parse');
					expect(resolveDate(r.value.value, ctx)).toEqual({ ok: true, value: e });
					// Without an offset, the local time must name this instant alone.
					if (d.zone === null) expect(localInstants(d, ctx)).toEqual([e]);
				}),
				RUNS,
			);
		});
	}
});

describe('R5: timing resolution alignment', () => {
	const date = fc.record({
		year: fc.integer({ min: 1970, max: 2035 }),
		month: fc.integer({ min: 1, max: 12 }),
		day: fc.integer({ min: 1, max: 28 }),
		hour: fc.integer({ min: 0, max: 23 }),
		minute: fc.integer({ min: 0, max: 59 }),
		second: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 59 })),
		zone: fc.option(fc.integer({ min: -720, max: 840 })),
	});
	const resolution = fc.constantFrom(...TIMING_RESOLUTIONS);

	it('a date is accepted exactly when its instant is a multiple of the resolution', () => {
		fc.assert(
			fc.property(date, resolution, (d, minutes) => {
				const g = minutes * 60;
				const ofDay = d.hour * 3600 + d.minute * 60 + d.second - (d.zone ?? 0) * 60;
				const aligned = ((ofDay % g) + g) % g === 0;
				const r = resolveDate({ kind: 'date', date: d }, projectContext({ granularity: g }));
				if (aligned) expect(r.ok).toBe(true);
				else expect(r).toMatchObject({ ok: false, error: { tj: 'misaligned_date' } });
			}),
			RUNS,
		);
	});

	it('an interval duration is accepted exactly when it is a non-zero multiple of the resolution', () => {
		const amount = fc.oneof(
			fc.nat({ max: 600 }).map(int),
			fc.double({ min: 0, max: 600, noNaN: true }).map(float),
		);
		fc.assert(
			fc.property(
				amount,
				fc.constantFrom('min' as const, 'h' as const),
				resolution,
				(n, unit, minutes) => {
					const g = minutes * 60;
					const seconds = Math.trunc(n.value * (unit === 'min' ? 60 : 3600));
					const r = intervalSeconds({ amount: n, unit }, projectContext({ granularity: g }));
					if (n.value === 0) expect(r).toMatchObject({ ok: false, error: { tj: 'zero_duration' } });
					else if (seconds % g === 0) expect(r).toEqual({ ok: true, value: seconds });
					else expect(r).toMatchObject({ ok: false, error: { tj: 'iv_duration_not_aligned' } });
				},
			),
			RUNS,
		);
	});
});

describe('R6: integer and float duration math', () => {
	const resolution = fc.constantFrom(...TIMING_RESOLUTIONS).map((m) => m * 60);
	/** Exact model: integer division floors; float division rounds half up (n, f, g integers). */
	const floorDiv = (a: number, b: number) => Math.floor(a / b);
	const roundDiv = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));

	it('working minutes, hours and days: Integer math floors, Float math rounds', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 5000 }),
				fc.constantFrom('min' as const, 'h' as const, 'd' as const),
				fc.integer({ min: 1, max: 24 }),
				resolution,
				(n, unit, dwh, g) => {
					const factor = unit === 'min' ? 60 : unit === 'h' ? 3600 : 3600 * dwh;
					// `d` is a Float for a Float dailyworkinghours whatever the amount.
					const intCtx = projectContext({ granularity: g, dailyWorkingHours: int(dwh) });
					const floatCtx = projectContext({ granularity: g, dailyWorkingHours: float(dwh) });
					expect(workingSlots({ amount: int(n), unit }, intCtx)).toBe(floorDiv(n * factor, g));
					expect(workingSlots({ amount: float(n), unit }, intCtx)).toBe(roundDiv(n * factor, g));
					const dFloat = unit === 'd' ? roundDiv(n * factor, g) : floorDiv(n * factor, g);
					expect(workingSlots({ amount: int(n), unit }, floatCtx)).toBe(dFloat);
				},
			),
			RUNS,
		);
	});

	it('printing keeps every slot count, in any project context', () => {
		const ctx = fc.record({
			dailyWorkingHours: fc.oneof(
				fc.integer({ min: 1, max: 24 }).map(int),
				fc.double({ min: 1, max: 24, noNaN: true }).map(float),
			),
			yearlyWorkingDays: fc.oneof(
				fc.integer({ min: 100, max: 366 }).map(int),
				fc.constant(float(260.714)),
			),
			weeklyWorkingHours: fc.integer({ min: 1, max: 168 }),
			granularity: resolution,
		});
		fc.assert(
			fc.property(arbitraries.duration, ctx, (v, c) => {
				if (v.kind !== 'duration') return;
				const p = projectContext(c);
				const back = parseValue('duration', print(v));
				if (!back.ok || back.value.kind !== 'duration') throw new Error('no parse');
				expect(workingSlots(back.value.value, p)).toBe(workingSlots(v.value, p));
				expect(calendarSlots(back.value.value, p)).toBe(calendarSlots(v.value, p));
			}),
			RUNS,
		);
	});
});

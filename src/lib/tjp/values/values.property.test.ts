// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Round-trip properties for every value kind (200 runs each):
 * - R1: parse(print(v)) deep-equals v for values the app creates (canonical values);
 * - R2: any other spelling of v (padding, other quotes, whitespace and comments between tokens)
 *   parses to a value equal to v, and prints as print(v), so print(parse(x)) means x;
 * - R3: parsing never throws, and error offsets stay inside the text;
 * - R4: dates the app writes for an instant resolve back to that instant (UTC and Berlin).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../../engine/runtime';
import { daysFromCivil, lastDayOfMonth } from './civil';
import { arbitraries, messy, type Variant } from './testing/arbitraries';
import {
	dateFromEpoch,
	parseValue,
	printDate,
	printValue,
	projectContext,
	resolveDate,
	sameValue,
	type TypedValue,
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
	const instant = fc
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
	for (const zone of [null, 'Europe/Berlin', 'Asia/Kathmandu', 'America/New_York']) {
		it(String(zone), () => {
			const ctx = projectContext({ zone, zones, granularity: 900 });
			fc.assert(
				fc.property(instant, (e) => {
					const d = dateFromEpoch(e, ctx);
					if (d === null) throw new Error(`no date for ${e}`);
					const text = printDate({ kind: 'date', date: d });
					const r = text.ok ? parseValue('date', text.value) : null;
					if (!r?.ok || r.value.kind !== 'date') throw new Error('no parse');
					expect(resolveDate(r.value.value, ctx)).toEqual({ ok: true, value: e });
				}),
				RUNS,
			);
		});
	}
});

// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../tests/grammar/corpus';
import { createTimeZoneHost } from '../../engine/timezone';
import type { ProjectInfo, ScheduleResult } from '../../engine/protocol';
import { dateEpoch, parseDate } from '../tjp/values/date';
import { dateText, displayDate } from './date-text';
import { at, project } from './testing';

const zones = createTimeZoneHost();

function projectOf(id: string): ProjectInfo {
	const file = path.join(ROOT, 'engine/golden/expected', `${id}.json`);
	const p = (JSON.parse(fs.readFileSync(file, 'utf8')) as { result: ScheduleResult }).result
		.project;
	if (!p) throw new Error(`${id} has no project`);
	return p;
}
const mins = (p: ProjectInfo, iso: string): number =>
	Math.round((Date.parse(iso) - Date.parse(p.start)) / 60_000);

/** The instant (epoch seconds) TaskJuggler reads from date text in the project's zone. */
function readBack(text: string, p: ProjectInfo): number | null {
	const parsed = parseDate(text);
	if (!parsed.ok || parsed.value.kind !== 'date') return null;
	const e = dateEpoch(parsed.value.date, { zone: p.timezone, zones });
	return e.ok ? e.value : null;
}

describe('dateText', () => {
	const utc = project();

	it('writes a date at midnight and a date with the time otherwise', () => {
		expect(dateText(0, utc)).toBe('2026-01-05');
		expect(dateText(at(0, 13), utc)).toBe('2026-01-05-13:00');
		expect(dateText(at(8, 9) + 30, utc)).toBe('2026-01-13-09:30');
	});

	it('writes local time in the project zone, across DST (syn-09, Berlin)', () => {
		const p = projectOf('syn-09-tz-dst-berlin');
		expect(dateText(mins(p, '2026-03-27T08:00:00Z'), p, zones)).toBe('2026-03-27-09:00');
		expect(dateText(mins(p, '2026-03-30T07:00:00Z'), p, zones)).toBe('2026-03-30-09:00');
		expect(dateText(mins(p, '2026-03-29T22:00:00Z'), p, zones)).toBe('2026-03-30');
	});

	it('gives an explicit offset only where the local time is ambiguous (autumn overlap)', () => {
		const p = projectOf('syn-09-tz-dst-berlin');
		// 02:30 on 25 October 2026 happens twice in Berlin: at +02:00 and at +01:00.
		expect(dateText(mins(p, '2026-10-25T00:30:00Z'), p, zones)).toBe('2026-10-25-02:30-+0200');
		expect(dateText(mins(p, '2026-10-25T01:30:00Z'), p, zones)).toBe('2026-10-25-02:30-+0100');
		expect(dateText(mins(p, '2026-10-25T02:30:00Z'), p, zones)).toBe('2026-10-25-03:30');
	});

	it('handles a fractional offset (syn-10, Kathmandu)', () => {
		const p = projectOf('syn-10-tz-fractional-offset');
		expect(dateText(mins(p, '2026-02-02T03:15:00Z'), p, zones)).toBe('2026-02-02-09:00');
		expect(dateText(mins(p, '2026-02-01T18:15:00Z'), p, zones)).toBe('2026-02-02');
	});

	it('is null without zone data for a named zone', () => {
		const p = projectOf('syn-11-tz-southern-sydney');
		expect(dateText(0, p)).toBeNull();
		expect(dateText(0, p, zones)).toBe('2026-09-21-10:00');
	});

	const ZONED = [
		'syn-09-tz-dst-berlin',
		'syn-10-tz-fractional-offset',
		'syn-11-tz-southern-sydney',
		'syn-21-tz-dst-edges-newyork',
		'upstream-fedora-20',
		'poc-sample',
		'syn-12-tz-unset',
	];
	for (const id of ZONED) {
		it(`parses back to the same instant with values/date.ts (${id})`, () => {
			const p = projectOf(id);
			const start = Date.parse(p.start) / 1000;
			const end = mins(p, p.end);
			const res = p.timingResolutionMin;
			fc.assert(
				fc.property(fc.integer({ min: 0, max: Math.floor(end / res) }), (k) => {
					const m = k * res;
					const text = dateText(m, p, zones);
					return text !== null && readBack(text, p) === start + m * 60;
				}),
				{ seed: 20261113, numRuns: 1000 },
			);
		});
	}

	it('parses back across every DST change of New York (syn-21), minute by minute', () => {
		const p = projectOf('syn-21-tz-dst-edges-newyork');
		const start = Date.parse(p.start) / 1000;
		for (const iso of ['2025-11-02T04:00:00Z', '2026-03-08T05:00:00Z']) {
			const base = mins(p, iso);
			for (let m = base; m < base + 4 * 60; m += p.timingResolutionMin) {
				const text = dateText(m, p, zones);
				expect(text && readBack(text, p)).toBe(start + m * 60);
			}
		}
	});
});

describe('displayDate', () => {
	const utc = project();

	it('formats with Intl in the project zone', () => {
		expect(displayDate(at(7, 9), utc, { locale: 'en-GB', style: 'weekday' })).toBe('Mon 12 Jan');
		expect(displayDate(at(7, 9), utc, { locale: 'en-GB' })).toBe('12 Jan 2026');
		expect(displayDate(at(7, 9), utc, { locale: 'en-GB', style: 'time' })).toBe('09:00');
		const p = projectOf('syn-11-tz-southern-sydney');
		// 00:00Z is 10:00 in Sydney (month abbreviations vary with the ICU version).
		expect(displayDate(0, p, { locale: 'en-GB', style: 'date-time' })).toMatch(
			/^21 \S+ 2026, 10:00$/,
		);
	});

	it('shows an end at midnight as the last day worked', () => {
		expect(displayDate(at(3, 0), utc, { locale: 'en-GB', end: true })).toBe('7 Jan 2026');
		expect(displayDate(at(3, 0), utc, { locale: 'en-GB' })).toBe('8 Jan 2026');
		// A time style shows the instant itself.
		expect(displayDate(at(3, 0), utc, { locale: 'en-GB', style: 'time', end: true })).toBe('00:00');
	});

	it('falls back to UTC for a zone Intl does not know', () => {
		const odd = { ...utc, timezone: 'Mars/Olympus' };
		expect(displayDate(at(7, 9), odd, { locale: 'en-GB', style: 'time' })).toBe('09:00');
	});
});

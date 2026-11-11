// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../../engine/runtime';
import { utcSeconds } from './civil';
import { projectContext } from './context';
import {
	parseInterval,
	parseIntervals,
	printInterval,
	printIntervals,
	resolveInterval,
	sameInterval,
	type Interval,
} from './interval';

const utc = (y: number, mo: number, d: number, h = 0) =>
	utcSeconds({ year: y, month: mo, day: d, hour: h, minute: 0, second: 0 });
const iv = (text: string, optionalEnd = true): Interval => {
	const r = parseInterval(text, 0, { optionalEnd });
	if (!r.ok) throw new Error(`${text}: ${r.error.code}`);
	return r.value;
};
const ctx = projectContext({});

describe('parseInterval', () => {
	it('reads the three forms', () => {
		expect(iv('2026-01-05 - 2026-01-09').end).toMatchObject({ kind: 'date' });
		expect(iv('2026-11-26 +2d').end).toMatchObject({ kind: 'duration', duration: { unit: 'd' } });
		expect(iv('2026-02-09').end).toBeNull();
		expect(iv('2026-01-05-2026-01-09').end).toMatchObject({ kind: 'date' });
		expect(iv('%{2026-01-05 + 1d} - %{2026-01-09 - 1d}').start).toMatchObject({ kind: 'calc' });
	});

	it('requires an end unless the rule allows a bare date', () => {
		expect(parseInterval('2026-01-05')).toMatchObject({
			ok: false,
			error: { code: 'unexpected-end' },
		});
		expect(parseInterval('2026-01-05 x')).toMatchObject({
			ok: false,
			error: { code: 'unexpected-token', from: 11 },
		});
	});

	it('gives the start and end spans for header edits', () => {
		const r = parseInterval(' 2026-01-05-09:00-+0000 +2m ', 100);
		expect(r).toMatchObject({
			ok: true,
			spans: { start: { from: 101, to: 123 }, end: { from: 124, to: 127 } },
		});
	});

	it('reads comma-separated lists', () => {
		const r = parseIntervals('2026-01-01, 2026-02-01 - 2026-02-03 ,2026-03-01 +1w');
		expect(r.ok && r.value.length).toBe(3);
		expect(r.ok && r.items.map((s) => s.start.from)).toEqual([0, 12, 37]);
		expect(parseIntervals('2026-01-01,')).toMatchObject({
			ok: false,
			error: { code: 'unexpected-end' },
		});
	});
});

describe('printInterval', () => {
	it('is canonical and reads back the same', () => {
		for (const [text, canon] of [
			['2026-1-5-2026-1-9', '2026-01-05 - 2026-01-09'],
			['2026-11-26+2d', '2026-11-26 +2d'],
			['2026-02-09', '2026-02-09'],
		] as const) {
			const p = printInterval(iv(text));
			expect(p).toEqual({ ok: true, value: canon });
			expect(sameInterval(iv(canon), iv(text))).toBe(true);
		}
		expect(printIntervals([iv('2026-02-09'), iv('2026-03-01 +1d')])).toEqual({
			ok: true,
			value: '2026-02-09, 2026-03-01 +1d',
		});
		expect(printIntervals([]).ok).toBe(false);
	});
});

describe('resolveInterval', () => {
	it('builds half-open ranges', () => {
		expect(resolveInterval(iv('2026-01-05 - 2026-01-09'), ctx)).toEqual({
			ok: true,
			value: [utc(2026, 1, 5), utc(2026, 1, 9)],
		});
		expect(resolveInterval(iv('2026-11-26 +2d'), ctx)).toEqual({
			ok: true,
			value: [utc(2026, 11, 26), utc(2026, 11, 28)],
		});
		expect(resolveInterval(iv('2026-02-09'), ctx)).toEqual({
			ok: true,
			value: [utc(2026, 2, 9), utc(2026, 2, 10)],
		});
	});

	it('takes a bare date to the same wall time next day in the project zone', () => {
		const berlin = projectContext({ zone: 'Europe/Berlin', zones: createTimeZoneHost() });
		const r = resolveInterval(iv('2026-03-29'), berlin);
		expect(r.ok && r.value[1] - r.value[0]).toBe(23 * 3600);
	});

	it("reports TaskJuggler's interval errors", () => {
		expect(resolveInterval(iv('2026-01-09 - 2026-01-09'), ctx)).toMatchObject({
			ok: false,
			error: { tj: 'start_before_end' },
		});
		expect(resolveInterval(iv('2026-01-09 +0d'), ctx)).toMatchObject({
			ok: false,
			error: { tj: 'zero_duration' },
		});
		const framed = projectContext({ start: utc(2026, 1, 5), end: utc(2026, 3, 1) });
		expect(resolveInterval(iv('2026-03-01 +1d'), framed, { inProject: true })).toMatchObject({
			ok: false,
			error: { tj: 'interval_start_in_range' },
		});
		expect(resolveInterval(iv('2026-02-28 +2d'), framed, { inProject: true })).toMatchObject({
			ok: false,
			error: { tj: 'interval_end_in_range' },
		});
		expect(resolveInterval(iv('2026-02-28 +1d'), framed, { inProject: true }).ok).toBe(true);
	});
});

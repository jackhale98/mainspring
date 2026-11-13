// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../tests/grammar/corpus';
import { createTimeZoneHost } from '../../engine/timezone';
import type { ProjectInfo, ScheduleResult } from '../../engine/protocol';
import { at, project, weekdays } from './testing';
import { workingTimeFromPairs, workingTimeOf, type WorkingTime } from './working-time';

const zones = createTimeZoneHost();

function golden(id: string): ScheduleResult {
	const file = path.join(ROOT, 'engine/golden/expected', `${id}.json`);
	return (JSON.parse(fs.readFileSync(file, 'utf8')) as { result: ScheduleResult }).result;
}
function projectOf(id: string): ProjectInfo {
	const p = golden(id).project;
	if (!p) throw new Error(`${id} has no project`);
	return p;
}
/** Minutes since the project start of an ISO instant. */
const mins = (p: ProjectInfo, iso: string): number =>
	Math.round((Date.parse(iso) - Date.parse(p.start)) / 60_000);

describe('working minutes on the default calendar (Mon-Fri 09:00-17:00)', () => {
	const wt = workingTimeOf(project());

	it('knows which minutes are working', () => {
		expect(wt.isWorking(at(0, 9))).toBe(true);
		expect(wt.isWorking(at(0, 17) - 1)).toBe(true);
		expect(wt.isWorking(at(0, 17))).toBe(false);
		expect(wt.isWorking(at(5, 12))).toBe(false); // Saturday
		expect(wt.total).toBe(8 * 5 * 8 * 60);
	});

	it('counts working minutes in a range, signed', () => {
		expect(wt.workingBetween(at(0, 0), at(1, 0))).toBe(480);
		// Friday 13:00 to Monday 11:00: four hours, then two.
		expect(wt.workingBetween(at(4, 13), at(7, 11))).toBe(360);
		expect(wt.workingBetween(at(7, 11), at(4, 13))).toBe(-360);
		expect(wt.workingBetween(at(5, 0), at(7, 9))).toBe(0);
	});

	it('adds working minutes as TaskJuggler walks a gaplength: to the end of the last slot', () => {
		// One day after Friday 17:00 ends on Monday 17:00, not on Tuesday 09:00.
		expect(wt.addWorking(at(4, 17), 480)).toBe(at(7, 17));
		expect(wt.addWorking(at(4, 13), 360)).toBe(at(7, 11));
		expect(wt.addWorking(at(5, 3), 60)).toBe(at(7, 10));
		expect(wt.addWorking(at(2, 10), 0)).toBe(at(2, 10));
	});

	it('subtracts working minutes to the start of the earliest slot counted back', () => {
		// One day before Monday 09:00 starts on Friday 09:00, not on Thursday 17:00.
		expect(wt.addWorking(at(7, 9), -480)).toBe(at(4, 9));
		expect(wt.addWorking(at(7, 11), -360)).toBe(at(4, 13));
		expect(wt.addWorking(at(7, 9), -1)).toBe(at(4, 17) - 1);
	});

	it('stops at the frame, as TaskJuggler does', () => {
		expect(wt.addWorking(at(50, 9), 100_000)).toBe(wt.frameEnd);
		expect(wt.addWorking(at(1, 9), -100_000)).toBe(0);
	});

	it('snaps a start forward and an end back to working time', () => {
		expect(wt.snap(at(4, 17), 'start')).toBe(at(7, 9));
		expect(wt.snap(at(2, 12), 'start')).toBe(at(2, 12));
		expect(wt.snap(at(7, 9), 'end')).toBe(at(4, 17));
		expect(wt.snap(at(2, 17), 'end')).toBe(at(2, 17));
		expect(wt.snap(at(2, 12), 'end')).toBe(at(2, 12));
	});

	it('finds working days and shifts by them', () => {
		expect(wt.dayStart(at(2, 14))).toBe(at(2, 9));
		expect(wt.dayStart(at(5, 14))).toBe(at(7, 9)); // Saturday: the next working day
		expect(wt.dayEnd(at(2, 14))).toBe(at(2, 17));
		// An end at midnight belongs to the day before it.
		expect(wt.dayEnd(at(3, 0))).toBe(at(2, 17));
		expect(wt.dayEnd(at(6, 12))).toBe(at(4, 17)); // Sunday: the working day before
		expect(wt.shiftDays(at(4, 9), 1, 'start')).toBe(at(7, 9));
		expect(wt.shiftDays(at(7, 17), -1, 'end')).toBe(at(4, 17));
		expect(wt.shiftDays(at(2, 13), 0, 'start')).toBe(at(2, 9));
		expect(wt.shiftDays(at(0, 9), -5, 'start')).toBe(at(0, 9)); // clamped to the first day
	});

	it('works with no working time at all', () => {
		const none = workingTimeFromPairs([], { resolution: 60, frameEnd: 1000 });
		expect(none.workingBetween(0, 1000)).toBe(0);
		expect(none.addWorking(10, 60)).toBe(1000);
		expect(none.addWorking(10, -60)).toBe(0);
		expect(none.snap(10, 'start')).toBe(10);
		expect(none.dayStart(10)).toBe(10);
		expect(none.shiftDays(10, 3, 'end')).toBe(10);
	});

	it('merges touching or unsorted pairs', () => {
		const w = workingTimeFromPairs(
			[
				[120, 180],
				[0, 60],
				[60, 120],
			],
			{ resolution: 60, frameEnd: 240 },
		);
		expect(w.total).toBe(180);
		expect(w.addWorking(0, 150)).toBe(150);
	});
});

describe('working time from the engine (golden plans)', () => {
	it('splits a day with a lunch break, and counts dailyworkinghours 7.5 (syn-14)', () => {
		const p = projectOf('syn-14-workinghours-resolution');
		const wt = workingTimeOf(p, zones);
		const mon = (h: number, m = 0) => mins(p, `2026-01-05T${pad(h)}:${pad(m)}:00Z`);
		expect(wt.workingBetween(mon(0), mins(p, '2026-01-06T00:00:00Z'))).toBe(450);
		expect(
			wt.workingBetween(mins(p, '2026-01-09T00:00:00Z'), mins(p, '2026-01-10T00:00:00Z')),
		).toBe(240);
		expect(wt.isWorking(mon(12, 45))).toBe(false);
		expect(wt.snap(mon(12, 45), 'start')).toBe(mon(13, 30));
		expect(wt.snap(mon(12, 45), 'end')).toBe(mon(12, 30));
		expect(wt.dayStart(mon(12, 45))).toBe(mon(8, 30));
		expect(wt.dayEnd(mon(12, 45))).toBe(mon(17));
		// The engine's own end for hours.third: 21 working hours after Fri 11:30, at 15 minutes.
		expect(
			wt.workingBetween(mins(p, '2026-01-16T11:30:00Z'), mins(p, '2026-01-21T10:45:00Z')),
		).toBe(60 + 7.5 * 60 * 2 + 2.25 * 60);
	});

	it('keeps local working days across the spring DST change in Berlin (syn-09)', () => {
		const p = projectOf('syn-09-tz-dst-berlin');
		const wt = workingTimeOf(p, zones);
		const friStart = mins(p, '2026-03-27T08:00:00Z'); // 09:00 CET
		const monStart = mins(p, '2026-03-30T07:00:00Z'); // 09:00 CEST
		const monEnd = mins(p, '2026-03-30T15:00:00Z'); // 17:00 CEST
		expect(wt.isWorking(friStart)).toBe(true);
		expect(wt.isWorking(monStart)).toBe(true);
		expect(wt.isWorking(monStart - 1)).toBe(false);
		expect(wt.workingBetween(friStart, monEnd)).toBe(16 * 60);
		expect(wt.shiftDays(friStart, 1, 'start')).toBe(monStart);
		expect(wt.shiftDays(monEnd, -1, 'end')).toBe(mins(p, '2026-03-27T16:00:00Z'));
		expect(wt.dayStart(mins(p, '2026-03-28T12:00:00Z'))).toBe(monStart);
		expect(wt.addWorking(mins(p, '2026-03-27T16:00:00Z'), 60)).toBe(
			mins(p, '2026-03-30T08:00:00Z'),
		);
	});

	it('uses the local day, not the UTC day, at +05:45 (syn-10, Kathmandu)', () => {
		const p = projectOf('syn-10-tz-fractional-offset');
		expect(p.timingResolutionMin).toBe(15);
		const wt = workingTimeOf(p, zones);
		// 19:00Z on 2 Feb is 00:45 on 3 Feb in Kathmandu: the day is the 3rd.
		const late = mins(p, '2026-02-02T19:00:00Z');
		expect(wt.dayStart(late)).toBe(mins(p, '2026-02-03T03:15:00Z'));
		expect(wt.dayEnd(late)).toBe(mins(p, '2026-02-03T11:15:00Z'));
		// The engine's dates for fractional.install: three working days after survey's end.
		expect(
			wt.workingBetween(mins(p, '2026-02-05T03:15:00Z'), mins(p, '2026-02-10T11:15:00Z')),
		).toBe(4 * 480);
		// Without zone data the days fall back to UTC days (documented): the 2nd here.
		expect(workingTimeOf(p).dayStart(late)).toBe(mins(p, '2026-02-02T03:15:00Z'));
		expect(workingTimeOf(p).dayEnd(late)).toBe(mins(p, '2026-02-02T11:15:00Z'));
	});

	it('crosses the southern-hemisphere DST change in Sydney (syn-11)', () => {
		const p = projectOf('syn-11-tz-southern-sydney');
		const wt = workingTimeOf(p, zones);
		// The frame starts at 10:00 local on Monday 21 September: that day starts there.
		expect(wt.dayStart(0)).toBe(0);
		const fri = mins(p, '2026-10-01T23:00:00Z'); // Fri 2 Oct 09:00 AEST
		const mon = mins(p, '2026-10-04T22:00:00Z'); // Mon 5 Oct 09:00 AEDT
		expect(wt.shiftDays(fri, 1, 'start')).toBe(mon);
		expect(wt.workingBetween(fri, mon + 8 * 60)).toBe(16 * 60);
		expect(wt.addWorking(mon, -480)).toBe(fri);
	});
});

const pad = (n: number): string => String(n).padStart(2, '0');

/** Every golden plan with working time. */
const GOLDENS = fs
	.readdirSync(path.join(ROOT, 'engine/golden/expected'))
	.filter((f) => f.endsWith('.json'))
	.map((f) => f.slice(0, -5))
	.map((id) => ({ id, p: golden(id).project }))
	.filter((g): g is { id: string; p: ProjectInfo } => !!g.p && g.p.workingTime.length > 0);

describe('working-time properties over every golden plan', () => {
	it('has goldens to check', () => {
		expect(GOLDENS.length).toBeGreaterThan(30);
	});

	for (const { id, p } of GOLDENS) {
		it(`adds, subtracts and counts consistently (${id})`, () => {
			const wt: WorkingTime = workingTimeOf(p, zones);
			const end = wt.frameEnd;
			const res = p.timingResolutionMin;
			const slot = fc.integer({ min: 0, max: Math.floor(end / res) }).map((k) => k * res);
			fc.assert(
				fc.property(slot, fc.integer({ min: 1, max: 40 * 480 }), (a, w) => {
					const t = wt.addWorking(a, w);
					const left = wt.workingBetween(a, end);
					if (w > left) return t === end;
					// The earliest instant with exactly w working minutes since a.
					if (wt.workingBetween(a, t) !== w || wt.workingBetween(a, t - 1) >= w) return false;
					// Back again: the start of the first working minute at or after a.
					const back = wt.addWorking(t, -w);
					return back >= a && wt.workingBetween(a, back) === 0 && wt.isWorking(back);
				}),
				{ seed: 20261113, numRuns: 300 },
			);
		});

		it(`gives working days that start and end on working time (${id})`, () => {
			const wt = workingTimeOf(p, zones);
			const res = p.timingResolutionMin;
			const slot = fc.integer({ min: 0, max: Math.floor(wt.frameEnd / res) }).map((k) => k * res);
			fc.assert(
				fc.property(slot, (m) => {
					const s = wt.dayStart(m);
					const e = wt.dayEnd(m);
					// m itself only when there is no working day to go to.
					const okStart = s === m || wt.isWorking(s);
					const okEnd = e === m || wt.isWorking(e - 1);
					// Days are ordered: one back from a day's start is not after it.
					return okStart && okEnd && wt.shiftDays(s, -1, 'start') <= s;
				}),
				{ seed: 20261113, numRuns: 200 },
			);
		});
	}
});

describe('weekdays helper', () => {
	it('covers the default week', () => {
		expect(weekdays(7)).toHaveLength(5);
	});
});

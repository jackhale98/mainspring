// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for engine/golden/cross-check-load.mjs: the weekly resource load report of the schema
// v3 cross-check (phase-3 spec 5.3). The CSV below is laid out as tj3 writes it from
// cross-check-load.tji, with values worked out by hand from TaskJuggler's queries (the module
// header cites them); record-native.mjs runs the real tj3 against every golden with resources.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	LOAD_QUERIES,
	expectedLoad,
	loadDiffs,
	loadRanges,
	loadReport,
	parseLoadCsv,
	parseWeekStart,
	wallClockMs,
} from '../../engine/golden/cross-check-load.mjs';
import { parseCsv } from '../../engine/golden/cross-check-rows.mjs';

const DAY = 1440;
/** [start, end) of `from`-`to` o'clock on frame day `day`. */
const hours = (day: number, from: number, to: number): [number, number] => [
	day * DAY + from * 60,
	day * DAY + to * 60,
];
type Pairs = Array<[number, number]>;
/** A leaf's workingTime: null is the project's (T6 review ruling). */
const own = (pairs: Pairs): Pairs | null => pairs;
const workdays = (from: number, to: number, skip: number[] = []): Pairs =>
	[0, 1, 2, 3, 4, 7, 8, 9, 10, 11].filter((d) => !skip.includes(d)).map((d) => hours(d, from, to));

/**
 * Two weeks from Monday 2026-01-05 in UTC at 1-hour slots. Team `team` has `a` (efficiency 1,
 * 9-17, annual leave on day 2) and the part-timer `b` (efficiency 0.5, 9-13).
 */
function result() {
	return {
		project: {
			start: '2026-01-05T00:00:00Z',
			end: '2026-01-19T00:00:00Z',
			timezone: null,
			timingResolutionMin: 60,
			weekStartsMonday: true,
			workingTime: workdays(9, 17),
			scenarios: [
				{ id: 'plan', name: 'Plan', active: true },
				{ id: 'off', name: 'Off', active: false },
			],
		},
		resources: [
			{
				id: 'team',
				parent: null,
				group: true,
				scenarios: { plan: { efficiency: 1, workingTime: [], leaves: [] } },
			},
			{
				id: 'a',
				parent: 'team',
				group: false,
				scenarios: {
					plan: {
						efficiency: 1,
						workingTime: own(workdays(9, 17, [2])),
						leaves: [{ type: 'annual', intervals: [hours(2, 9, 17)] }],
					},
				},
			},
			{
				id: 'b',
				parent: 'team',
				group: false,
				scenarios: { plan: { efficiency: 0.5, workingTime: own(workdays(9, 13)), leaves: [] } },
			},
		],
		bookings: [
			{ scenario: 'plan', resource: 'a', task: 't', intervals: [hours(0, 9, 17), hours(7, 9, 13)] },
			{ scenario: 'plan', resource: 'b', task: 't', intervals: [hours(1, 9, 13)] },
		],
	};
}

const W1 = '2026-01-05T00:00:00+0000';
const W2 = '2026-01-12T00:00:00+0000';
const cell = (...v: number[]): string => `"${v.map((x) => x.toFixed(6)).join('|')}"`;
// The celltext column holds the frame, then week 1 (TaskJuggler's stale cell query; see the
// .tji). Freetime is whole 24-hour days for a leaf (a: 60 free hours print 48; b: 16 print 0)
// and exact for the group.
const CSV = [
	`"Scenario";"Id";"${W1}";"${W2}";"${W1}";"${W2}"`,
	`"Plan";"team";10.0;4.0;${cell(14, 78, 96, 8, 8, 0, 0, 0)};${cell(10, 32, 40, 8, 8, 0, 0, 0)}`,
	`"Plan";"  a";8.0;4.0;${cell(12, 60, 48, 8, 8, 0, 0, 0)};${cell(8, 24, 24, 8, 8, 0, 0, 0)}`,
	`"Plan";"  b";2.0;"";${cell(2, 18, 24, 0, 0, 0, 0, 0)};${cell(2, 8, 0, 0, 0, 0, 0, 0)}`,
	'',
].join('\n');

describe('loadReport', () => {
	const template = readFileSync(
		new URL('../../engine/golden/cross-check-load.tji', import.meta.url),
		'utf8',
	);

	it('writes the active scenarios and the plan zone into the macros', () => {
		const text = loadReport(template, {
			...result(),
			project: { ...result().project, timezone: 'Europe/Berlin' },
		});
		expect(text).toContain('macro mainspring_crossload_scenarios [plan]\n');
		expect(text).toContain('macro mainspring_crossload_timezone ["Europe/Berlin"]\n');
		expect(loadReport(template, result())).toContain('timezone ["UTC"]');
	});

	it('refuses a template without its macros and a zone it cannot quote', () => {
		expect(() => loadReport('resourcereport x "x" {}', result())).toThrow(/macro/);
		const bad = { ...result(), project: { ...result().project, timezone: 'a"b' } };
		expect(() => loadReport(template, bad)).toThrow(/cannot go in a macro/);
	});
});

describe('week headers and wall clocks', () => {
	it('reads the local time and offset TaskJuggler prints', () => {
		expect(parseWeekStart('2026-03-30T00:00:00+0200')).toEqual({
			ms: Date.UTC(2026, 2, 29, 22),
			wall: Date.UTC(2026, 2, 30),
		});
		expect(parseWeekStart('2025-11-02T00:00:00-0400').ms).toBe(Date.UTC(2025, 10, 2, 4));
		expect(() => parseWeekStart('2026-03-30')).toThrow(/week header/);
	});

	it('gives the wall-clock time of an instant in a zone', () => {
		expect(wallClockMs(Date.UTC(2026, 6, 1, 22), 'Europe/Berlin')).toBe(Date.UTC(2026, 6, 2));
		expect(wallClockMs(Date.UTC(2026, 0, 1, 5), 'UTC')).toBe(Date.UTC(2026, 0, 1, 5));
	});
});

describe('loadRanges', () => {
	it('clamps like Project#dateToIdx and ends the last week at the frame end on a week boundary', () => {
		const r = loadRanges(result().project, [W1, W2]);
		expect(r).toEqual({
			frame: [0, 336],
			weeks: [
				[0, 168],
				[168, 336],
			],
			res: 60,
		});
	});

	it('leaves out the last slot when the last week runs past the end', () => {
		const project = { ...result().project, end: '2026-01-16T00:00:00Z' };
		expect(loadRanges(project, [W1, W2]).weeks[1]).toEqual([168, 263]);
		// A week that starts before the frame starts at slot 0.
		const late = { ...project, start: '2026-01-06T00:00:00Z' };
		expect(loadRanges(late, [W1, W2]).weeks[0]).toEqual([0, 144]);
	});

	it('asks the zone for the end wall-clock time', () => {
		const seen: string[] = [];
		loadRanges({ ...result().project, timezone: 'Asia/Kathmandu' }, [W1, W2], (_ms, zone) => {
			seen.push(zone);
			return 0;
		});
		expect(seen).toEqual(['Asia/Kathmandu']);
	});

	it('refuses weeks that do not reach the frame end', () => {
		expect(() => loadRanges(result().project, [W1])).toThrow(/do not end/);
	});
});

describe('parseLoadCsv', () => {
	it('reads both columns, carries and trims ids, and reads an empty load cell as 0', () => {
		const { weeks, rows } = parseLoadCsv(parseCsv(CSV));
		expect(weeks).toEqual([W1, W2]);
		expect(rows.map((r) => r.id)).toEqual(['team', 'a', 'b']);
		expect(rows[2]?.plain).toEqual([2, 0]);
		expect(rows[0]?.cells[0]).toEqual([14, 78, 96, 8, 8, 0, 0, 0]);
		const twoScenarios = parseCsv(
			`"Scenario";"Id";"${W1}";"${W1}"\n"Plan";"a";1.0;${cell(1, 0, 0, 0, 0, 0, 0, 0)}\n"Late";"";"";${cell(0, 0, 0, 0, 0, 0, 0, 0)}\n`,
		);
		expect(parseLoadCsv(twoScenarios).rows.map((r) => `${r.scenario}/${r.id}`)).toEqual([
			'Plan/a',
			'Late/a',
		]);
	});

	it('refuses an unexpected layout', () => {
		expect(() => parseLoadCsv(parseCsv(`"Id";"x"\n`))).toThrow(/header/);
		expect(() =>
			parseLoadCsv(parseCsv(`"Scenario";"Id";"${W1}";"${W2}"\n"Plan";"a";1.0;"1|2"\n`)),
		).toThrow(/different weeks/);
		expect(() =>
			parseLoadCsv(parseCsv(`"Scenario";"Id";"${W1}";"${W1}"\n"Plan";"a";1.0;"1|2"\n`)),
		).toThrow(/celltext/);
	});
});

describe('expectedLoad and loadDiffs', () => {
	it('derives every value from bookings, workingTime, leaves and efficiency', () => {
		const r = result();
		const load = expectedLoad(r, loadRanges(r.project, [W1, W2]));
		expect(load.get('Plan\nb')).toEqual({
			plain: [2, 0],
			cells: [
				[2, 18, 24, 0, 0, 0, 0, 0],
				[2, 8, 0, 0, 0, 0, 0, 0],
			],
		});
		expect([...load.keys()]).toEqual(['Plan\nteam', 'Plan\na', 'Plan\nb']);
		expect(LOAD_QUERIES).toHaveLength(8);
	});

	it("reads a null workingTime as the project's", () => {
		const explicit = result();
		const c1 = explicit.resources[1]?.scenarios.plan;
		if (!c1) throw new Error('no a');
		c1.workingTime = workdays(9, 17);
		c1.leaves = [];
		const nulled = result();
		const c2 = nulled.resources[1]?.scenarios.plan;
		if (!c2) throw new Error('no a');
		c2.workingTime = null;
		c2.leaves = [];
		const ranges = loadRanges(explicit.project, [W1, W2]);
		const a = expectedLoad(nulled, ranges).get('Plan\na');
		expect(a).toEqual(expectedLoad(explicit, ranges).get('Plan\na'));
		expect(a?.cells[0]).toEqual([12, 68, 48, 0, 0, 0, 0, 0]);
	});

	it('agrees with a matching report', () => {
		const d = loadDiffs(result(), parseCsv(CSV));
		expect(d).toEqual({ problems: [], rows: 3, weeks: 2, compared: 2 + 3 * (2 + 2 * 8) });
	});

	it("checks that TaskJuggler's weeks start on the golden's week start day", () => {
		const r = result();
		r.project.weekStartsMonday = false;
		expect(loadDiffs(r, parseCsv(CSV)).problems).toEqual([
			"the week of 2026-01-05T00:00:00+0000 starts on weekday 1; the golden's weekStartsMonday is false",
			"the week of 2026-01-12T00:00:00+0000 starts on weekday 1; the golden's weekStartsMonday is false",
		]);
	});

	it('accepts the printed precision and nothing coarser', () => {
		const r = result();
		const b = r.resources[2]?.scenarios.plan;
		if (!b) throw new Error('no b');
		b.efficiency = 1 / 3;
		const csv = CSV.replace(
			`"Plan";"  b";2.0;"";${cell(2, 18, 24, 0, 0, 0, 0, 0)};${cell(2, 8, 0, 0, 0, 0, 0, 0)}`,
			`"Plan";"  b";1.333333;"";${cell(4 / 3, 12, 24, 0, 0, 0, 0, 0)};${cell(4 / 3, 16 / 3, 0, 0, 0, 0, 0, 0)}`,
		).replace(
			`"Plan";"team";10.0;4.0;${cell(14, 78, 96, 8, 8, 0, 0, 0)};${cell(10, 32, 40, 8, 8, 0, 0, 0)}`,
			`"Plan";"team";9.333333;4.0;${cell(40 / 3, 72, 96, 8, 8, 0, 0, 0)};${cell(28 / 3, 88 / 3, 40, 8, 8, 0, 0, 0)}`,
		);
		expect(loadDiffs(r, parseCsv(csv)).problems).toEqual([]);
		const off = csv.replace('"Plan";"  b";1.333333', '"Plan";"  b";1.333335');
		expect(loadDiffs(r, parseCsv(off)).problems).toEqual([
			'Plan / b, week of 2026-01-05T00:00:00+0000: effort 1.333335 h natively, golden bookings x efficiency 1.3333333333333333 h',
		]);
	});

	it.each([
		[
			'a booking',
			(r: ReturnType<typeof result>) => {
				const first = r.bookings[0]?.intervals[0];
				if (first) first[1] -= 60;
			},
			/Plan \/ team, week of 2026-01-05T00:00:00\+0000: effort 10 h natively, golden bookings x efficiency 9 h/,
		],
		[
			'working time',
			(r: ReturnType<typeof result>) => {
				r.resources[1]?.scenarios.plan?.workingTime?.pop();
			},
			/frame .*: freework 78 h natively, golden 70 h/,
		],
		[
			'a leave type',
			(r: ReturnType<typeof result>) => {
				const leave = r.resources[1]?.scenarios.plan?.leaves[0];
				if (leave) leave.type = 'sick';
			},
			/annualleave 8 h natively, golden 0 h/,
		],
		[
			'efficiency',
			(r: ReturnType<typeof result>) => {
				const a = r.resources[1]?.scenarios.plan;
				if (a) a.efficiency = 0.5;
			},
			/effort 10 h natively, golden bookings x efficiency 6 h/,
		],
	])('reports a changed %s', (_what, mutate, line) => {
		const r = result();
		mutate(r);
		const { problems } = loadDiffs(r, parseCsv(CSV));
		expect(problems.length).toBeGreaterThan(0);
		expect(problems.join('\n')).toMatch(line);
	});

	it('reports missing and unknown rows', () => {
		const lines = CSV.split('\n');
		const missing = [...lines.slice(0, 3), ''].join('\n');
		expect(loadDiffs(result(), parseCsv(missing)).problems).toEqual(['no report row for Plan / b']);
		const unknown = CSV.replace('"  b"', '"  c"');
		expect(loadDiffs(result(), parseCsv(unknown)).problems).toEqual([
			'report row Plan / c names no resource and active scenario of the golden',
			'no report row for Plan / b',
		]);
	});
});

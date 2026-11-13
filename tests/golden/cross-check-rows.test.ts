// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for engine/golden/cross-check-rows.mjs: the parser for the CSV that tj3 writes
// from cross-check.tji, and the rows that report should hold for a golden's result (dates,
// precursors and completion). Split from record-lib.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	CROSS_CHECK_HEADER,
	csvLinkRows,
	csvRows,
	expectedLinkRows,
	expectedRows,
	linkRowDiffs,
	parseCsv,
	rowDiffs,
	withoutPrecursors,
} from '../../engine/golden/cross-check-rows.mjs';
import { minutesToIso } from '../../engine/golden/lib.mjs';

describe('parseCsv', () => {
	it('reads quoted, empty and unquoted fields', () => {
		const text =
			'"Scenario";"Id";"Start";"End"\n"Plan";"a.b";"2026-01-05T08:00:00Z";""\n"Delayed";"";Error;5\n';
		expect(parseCsv(text)).toEqual([
			['Scenario', 'Id', 'Start', 'End'],
			['Plan', 'a.b', '2026-01-05T08:00:00Z', ''],
			['Delayed', '', 'Error', '5'],
		]);
	});

	it('handles doubled quotes, separators and line breaks inside quotes', () => {
		expect(parseCsv('"say ""hi"";now";"two\nlines"')).toEqual([['say "hi";now', 'two\nlines']]);
	});
});

const none = { depends: [], precedes: [], complete: null };
const result = {
	project: {
		start: '2026-01-05T00:00:00Z',
		scenarios: [
			{ id: 'plan', name: 'Plan', active: true },
			{ id: 'off', name: 'Off', active: false },
			{ id: 'delayed', name: 'Delayed', active: true },
		],
	},
	tasks: [
		{
			id: 'top',
			scenarios: {
				plan: { start: 480, end: 3840, ...none },
				delayed: { start: 480, end: null, ...none },
			},
		},
		{
			id: 'top.x',
			scenarios: {
				plan: { start: 480, end: 960, ...none, complete: 40.5 },
				delayed: { start: 480, end: 960, ...none, complete: 40.5 },
			},
		},
		{
			id: 'top.y',
			scenarios: {
				plan: {
					start: 960,
					end: 1440,
					depends: [{ task: 'top.x', onEnd: true }],
					precedes: [{ task: 'top.z', onEnd: true }],
					complete: null,
				},
				delayed: {
					start: 960,
					end: 1440,
					depends: [{ task: 'top.x', onEnd: false }],
					precedes: [],
					complete: 0,
				},
			},
		},
		{
			id: 'top.z',
			scenarios: {
				plan: {
					start: 1440,
					end: 1920,
					depends: [{ task: 'top.x', onEnd: true }],
					precedes: [],
					complete: null,
				},
				delayed: { start: 1440, end: 1920, ...none },
			},
		},
	],
};

const header = CROSS_CHECK_HEADER.map((h) => `"${h}"`).join(';');
const csv = parseCsv(
	[
		header,
		'"Plan";"top";"2026-01-05T08:00:00Z";"2026-01-07T16:00:00Z";"";"50%"',
		'"Delayed";"";"2026-01-05T08:00:00Z";"Error";"";"0%"',
		'"Plan";"top.x";"2026-01-05T08:00:00Z";"2026-01-05T16:00:00Z";"";"40%"',
		'"Delayed";"";"2026-01-05T08:00:00Z";"2026-01-05T16:00:00Z";"";"40%"',
		'"Plan";"top.y";"2026-01-05T16:00:00Z";"2026-01-06T00:00:00Z";"top.x ]->[";"100%"',
		'"Delayed";"";"2026-01-05T16:00:00Z";"2026-01-06T00:00:00Z";"top.x [->[";"0%"',
		'"Plan";"top.z";"2026-01-06T00:00:00Z";"2026-01-06T08:00:00Z";"top.y ]->], top.x ]->[";"0%"',
		'"Delayed";"";"2026-01-06T00:00:00Z";"2026-01-06T08:00:00Z";"";"0%"',
		'',
	].join('\n'),
);

describe('cross-check rows', () => {
	it('builds one row per task and active scenario', () => {
		expect(expectedRows(result)).toEqual([
			'Plan | top | 2026-01-05T08:00:00Z | 2026-01-07T16:00:00Z',
			'Delayed | top | 2026-01-05T08:00:00Z | ',
			'Plan | top.x | 2026-01-05T08:00:00Z | 2026-01-05T16:00:00Z',
			'Delayed | top.x | 2026-01-05T08:00:00Z | 2026-01-05T16:00:00Z',
			'Plan | top.y | 2026-01-05T16:00:00Z | 2026-01-06T00:00:00Z',
			'Delayed | top.y | 2026-01-05T16:00:00Z | 2026-01-06T00:00:00Z',
			'Plan | top.z | 2026-01-06T00:00:00Z | 2026-01-06T08:00:00Z',
			'Delayed | top.z | 2026-01-06T00:00:00Z | 2026-01-06T08:00:00Z',
		]);
	});

	it('carries task ids forward and maps non-dates to null', () => {
		expect(csvRows(csv)).toEqual(expectedRows(result));
		expect(rowDiffs(expectedRows(result), csvRows(csv))).toEqual([]);
	});

	it('reports a one-minute difference', () => {
		const shifted = structuredClone(result);
		const x = shifted.tasks[1];
		if (x?.scenarios['plan']) x.scenarios['plan'].end = 961;
		expect(rowDiffs(expectedRows(shifted), csvRows(csv))).toEqual([
			'row 3: serializer Plan | top.x | 2026-01-05T08:00:00Z | 2026-01-05T16:01:00Z; ' +
				'report Plan | top.x | 2026-01-05T08:00:00Z | 2026-01-05T16:00:00Z',
		]);
	});

	it('reports missing and extra rows', () => {
		expect(rowDiffs(['a', 'b'], ['a'])).toEqual(['row 2: serializer b; report (none)']);
		expect(rowDiffs([], ['a'])).toEqual(['row 1: serializer (none); report a']);
	});

	it('rejects an unexpected header', () => {
		expect(() => csvRows([['Id', 'Start']])).toThrow(/unexpected cross-check CSV header/);
		expect(() => csvRows([['Scenario', 'Id', 'Start', 'End']])).toThrow(/header/);
		expect(() => csvLinkRows([['Scenario', 'Id', 'Start', 'End']])).toThrow(/header/);
	});

	it('has no rows without a project', () => {
		expect(expectedRows({ project: null, tasks: [] })).toEqual([]);
		expect(expectedLinkRows({ project: null, tasks: [] })).toEqual([]);
	});

	it('converts minutes to ISO instants', () => {
		expect(minutesToIso('2026-01-05T00:00:00Z', 1980)).toBe('2026-01-06T09:00:00Z');
		expect(minutesToIso('2026-01-05T00:00:00Z', null)).toBeNull();
	});
});

describe('cross-check dependency and completion rows', () => {
	it("lists each task's own depends and the precedes that name it, sorted", () => {
		expect(expectedLinkRows(result)).toEqual([
			'Plan | top |  | *',
			'Delayed | top |  | *',
			'Plan | top.x |  | 40%',
			'Delayed | top.x |  | 40%',
			'Plan | top.y | top.x ]->[ | *',
			'Delayed | top.y | top.x [->[ | 0%',
			'Plan | top.z | top.x ]->[, top.y ]->] | *',
			'Delayed | top.z |  | *',
		]);
	});

	it("marks a precedes on the other task's start as ]->[", () => {
		const r = structuredClone(result);
		const y = r.tasks[2]?.scenarios['plan'];
		if (y) y.precedes = [{ task: 'top.z', onEnd: false }];
		expect(expectedLinkRows(r)[6]).toBe('Plan | top.z | top.x ]->[, top.y ]->[ | *');
	});

	it('agrees with the report, whatever it prints for an unset completion', () => {
		expect(csvLinkRows(csv)[6]).toBe('Plan | top.z | top.x ]->[, top.y ]->] | 0%');
		expect(linkRowDiffs(expectedLinkRows(result), csvLinkRows(csv))).toEqual([]);
	});

	it('reports a wrong end, a missing edge and a different completion', () => {
		const r = structuredClone(result);
		const y = r.tasks[2]?.scenarios;
		if (!y?.['plan'] || !y['delayed']) throw new Error('fixture');
		y['plan'].depends = [{ task: 'top.x', onEnd: false }];
		y['plan'].precedes = [];
		y['delayed'].complete = 1;
		expect(linkRowDiffs(expectedLinkRows(r), csvLinkRows(csv))).toEqual([
			'row 5: serializer Plan | top.y | top.x [->[ | *; report Plan | top.y | top.x ]->[ | 100%',
			'row 6: serializer Delayed | top.y | top.x [->[ | 1%; report Delayed | top.y | top.x [->[ | 0%',
			'row 7: serializer Plan | top.z | top.x ]->[ | *; ' +
				'report Plan | top.z | top.x ]->[, top.y ]->] | 0%',
		]);
	});

	it('skips precursors but still compares completion when the run is not ok', () => {
		const r = structuredClone(result);
		const y = r.tasks[2]?.scenarios;
		if (!y?.['plan'] || !y['delayed']) throw new Error('fixture');
		y['plan'].depends = [{ task: 'top.z', onEnd: false }];
		expect(linkRowDiffs(expectedLinkRows(r), csvLinkRows(csv), 10, false)).toEqual([]);
		y['delayed'].complete = 1;
		expect(linkRowDiffs(expectedLinkRows(r), csvLinkRows(csv), 10, false)).toEqual([
			'row 6: serializer Delayed | top.y | top.x [->[ | 1%; report Delayed | top.y | top.x [->[ | 0%',
		]);
		expect(linkRowDiffs(['a | b |  | *'], [], 10, false)).toHaveLength(1);
	});

	it('reads a report made without the precursors column', () => {
		const short = parseCsv(
			[
				'"Scenario";"Id";"Start";"End";"Completion"',
				'"Plan";"top";"2026-01-05T08:00:00Z";"";"0%"',
				'"Delayed";"";"";"";"40%"',
				'',
			].join('\n'),
		);
		expect(csvLinkRows(short)).toEqual(['Plan | top |  | 0%', 'Delayed | top |  | 40%']);
		expect(csvRows(short)).toEqual(['Plan | top | 2026-01-05T08:00:00Z | ', 'Delayed | top |  | ']);
	});

	it('removes exactly the precursors column line from cross-check.tji', () => {
		const template = readFileSync(
			new URL('../../engine/golden/cross-check.tji', import.meta.url),
			'utf8',
		);
		const cut = withoutPrecursors(template);
		expect(template.split('\n').length - cut.split('\n').length).toBe(1);
		expect(cut).not.toMatch(/^\s*precursors \{/m);
		expect(cut).toContain('  columns scenario, id, start, end,\n          complete\n');
		expect(() => withoutPrecursors(cut)).toThrow(/precursors column line/);
	});

	it('reports missing rows and never matches a wildcard to a missing row', () => {
		expect(linkRowDiffs(['a | b |  | *'], [])).toEqual([
			'row 1: serializer a | b |  | *; report (none)',
		]);
		expect(linkRowDiffs([], ['a | b |  | 0%'])).toEqual([
			'row 1: serializer (none); report a | b |  | 0%',
		]);
	});
});

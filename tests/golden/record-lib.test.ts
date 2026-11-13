// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for engine/golden/lib.mjs and cross-check-rows.mjs, the pure
// helpers of the native golden recorder (record-native.mjs). The recorder itself
// needs native TaskJuggler and never runs in CI; these helpers do not.
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
} from '../../engine/golden/cross-check-rows.mjs';
import {
	GOLDEN_SCHEMA_VERSION,
	NOW_RE,
	canonical,
	canonicalJson,
	diffPaths,
	firstError,
	manifestProblems,
	messageDiffs,
	minutesToIso,
	normaliseMessages,
	nowProblem,
	workspacePath,
} from '../../engine/golden/lib.mjs';

describe('nowProblem', () => {
	it('accepts a whole UTC hour with seconds', () => {
		expect(nowProblem('2026-01-05T09:00:00Z')).toBeNull();
		expect(nowProblem('2028-02-29T00:00:00Z')).toBeNull();
	});

	it.each([
		['2026-01-05T09:00Z', 'ISO 8601'],
		['2026-01-05 09:00:00Z', 'ISO 8601'],
		['2026-01-05T09:00:00+01:00', 'ISO 8601'],
		['2026-01-05T09:00:00.000Z', 'ISO 8601'],
		['2026-02-31T09:00:00Z', 'real date'],
		['2027-02-29T09:00:00Z', 'real date'],
		['2026-01-05T24:00:00Z', 'real date'],
		['2026-13-01T00:00:00Z', 'real date'],
		['2026-01-05T09:30:00Z', 'whole UTC hour'],
		['2026-01-05T09:00:01Z', 'whole UTC hour'],
	])('rejects %s', (value, reason) => {
		expect(nowProblem(value)).toContain(reason);
	});

	it('rejects non-strings', () => {
		expect(nowProblem(null)).toBe('must be a string');
		expect(nowProblem(1767603600000)).toBe('must be a string');
	});

	it('uses the same pattern as the bridge', () => {
		const source = readFileSync('engine/bridge/request.rb', 'utf8');
		const bridge = /NOW_RE = \/(.*)\/\.freeze/.exec(source)?.[1];
		expect(bridge).toBeDefined();
		expect(bridge?.replace(/^\\A/, '^').replace(/\\z$/, '$')).toBe(NOW_RE.source);
	});
});

describe('canonical JSON', () => {
	it('sorts keys recursively and keeps array order', () => {
		const v = canonical({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } });
		expect(JSON.stringify(v)).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
	});

	it('writes 2-space indent, compact empty containers and a trailing newline', () => {
		expect(canonicalJson({ b: [], a: {} })).toBe('{\n  "a": {},\n  "b": []\n}\n');
	});
});

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

	it('reports missing rows and never matches a wildcard to a missing row', () => {
		expect(linkRowDiffs(['a | b |  | *'], [])).toEqual([
			'row 1: serializer a | b |  | *; report (none)',
		]);
		expect(linkRowDiffs([], ['a | b |  | 0%'])).toEqual([
			'row 1: serializer (none); report a | b |  | 0%',
		]);
	});

	it('uses the schema version the recorder writes', () => {
		const recorder = readFileSync(
			new URL('../../engine/bridge/native/record.rb', import.meta.url),
			'utf8',
		);
		expect(GOLDEN_SCHEMA_VERSION).toBe(2);
		expect(recorder).toContain(`'schemaVersion' => ${GOLDEN_SCHEMA_VERSION},`);
	});
});

describe('workspace paths and messages', () => {
	const root = '/tmp/ws-1';

	it('makes paths workspace-relative and resolves . and ..', () => {
		expect(workspacePath('/tmp/ws-1/plan.tjp', root)).toBe('plan.tjp');
		expect(workspacePath('/tmp/ws-1/parts/deep/../shared.tji', root)).toBe('parts/shared.tji');
		expect(workspacePath('./parts/x.tji', `${root}/`)).toBe('parts/x.tji');
		expect(workspacePath('/tmp/ws-10/plan.tjp', root)).toBeNull();
		expect(workspacePath('/tmp/ws-1/../escape.tji', root)).toBeNull();
		expect(workspacePath(null, root)).toBeNull();
	});

	it('normalises messages the way the bridge does', () => {
		const raw = [
			{
				level: 'error',
				id: 'bad_include',
				text: 'Cannot open include file /tmp/ws-1/a/b.tji',
				file: '/tmp/ws-1/plan.tjp',
				line: 2,
			},
			{ level: 'error', id: 'no_tasks', text: 'No tasks defined', file: null, line: null },
			{ level: 'warning', id: 'w', text: 'x', file: '/tmp/ws-1/plan.tjp', line: 0 },
		];
		expect(normaliseMessages(raw, root)).toEqual([
			{
				level: 'error',
				id: 'bad_include',
				text: 'Cannot open include file a/b.tji',
				file: 'plan.tjp',
				line: 2,
			},
			{ level: 'error', id: 'no_tasks', text: 'No tasks defined', file: null, line: null },
			{ level: 'warning', id: 'w', text: 'x', file: 'plan.tjp', line: null },
		]);
	});

	it('compares messages field by field and finds the first error', () => {
		const a = [
			{ level: 'warning', id: 'w', text: 'x', file: 'plan.tjp', line: 3 },
			{ level: 'error', id: 'e', text: 'y', file: 'lib/a.tji', line: 6 },
		];
		const b = [{ ...a[0]!, line: 4 }, a[1]!];
		expect(messageDiffs(a, a)).toEqual([]);
		expect(messageDiffs(a, b)).toHaveLength(1);
		expect(messageDiffs(a, [a[0]!])).toEqual([
			'message 2: serializer ["error","e","lib/a.tji",6,"y"]; report (none)',
		]);
		expect(firstError(a)?.id).toBe('e');
		expect(firstError([a[0]!])).toBeNull();
	});
});

describe('manifestProblems', () => {
	const plan = {
		id: 'bridge-now-line',
		kind: 'bridge',
		root: 'engine/golden/plans/bridge/now-line',
		entry: 'plan.tjp',
		now: '2026-01-05T09:00:00Z',
		features: ['bridge'],
	};

	it('accepts the committed manifest, including kind bridge', () => {
		const manifest: unknown = JSON.parse(readFileSync('engine/golden/manifest.json', 'utf8'));
		expect(manifestProblems(manifest)).toEqual([]);
		const kinds = (manifest as { kind: string }[]).map((p) => p.kind);
		expect(kinds).toHaveLength(39);
		expect(kinds.filter((k) => k === 'bridge')).toHaveLength(8);
	});

	it('accepts every plan kind', () => {
		for (const kind of ['upstream', 'poc', 'synthetic', 'bridge']) {
			expect(manifestProblems([{ ...plan, kind }])).toEqual([]);
		}
	});

	it('reports bad entries', () => {
		expect(manifestProblems({})).toEqual(['manifest must be an array of GoldenPlan']);
		expect(
			manifestProblems([
				plan,
				plan,
				{ ...plan, id: 'Bad_Id', kind: 'other', now: '2026-01-05T09:30:00Z', features: 'x' },
				{ ...plan, id: 'no-root', root: '', files: [], timeoutMs: 0 },
			]),
		).toEqual([
			'"bridge-now-line": duplicate id',
			'"Bad_Id": id must be lower-case kebab',
			'"Bad_Id": kind must be one of upstream, poc, synthetic, bridge',
			'"Bad_Id": now must be on a whole UTC hour',
			'"Bad_Id": features must be an array',
			'"no-root": root must be a non-empty string',
			'"no-root": files must be a non-empty array',
			'"no-root": timeoutMs must be a positive integer',
		]);
	});
});

describe('diffPaths', () => {
	it('lists differing paths', () => {
		expect(diffPaths({ a: [1, 2], b: 'x' }, { a: [1, 3], b: 'x', c: true })).toEqual([
			'/a/1: expected 2, got 3',
			'/c: expected undefined, got true',
		]);
		expect(diffPaths({ a: 1 }, { a: 1 })).toEqual([]);
	});
});

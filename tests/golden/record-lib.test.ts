// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for engine/golden/lib.mjs, the pure helpers of the native golden recorder
// (record-native.mjs). The recorder itself needs native TaskJuggler and never runs in CI;
// these helpers do not. The cross-check CSV rows are tested in cross-check-rows.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	GOLDEN_SCHEMA_VERSION,
	NOW_RE,
	canonical,
	canonicalJson,
	diffPaths,
	firstError,
	manifestProblems,
	messageDiffs,
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
		expect(kinds).toHaveLength(40);
		expect(kinds.filter((k) => k === 'bridge')).toHaveLength(9);
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

describe('schema version', () => {
	it('uses the schema version the recorder writes', () => {
		const recorder = readFileSync(
			new URL('../../engine/bridge/native/record.rb', import.meta.url),
			'utf8',
		);
		expect(GOLDEN_SCHEMA_VERSION).toBe(2);
		expect(recorder).toContain(`'schemaVersion' => ${GOLDEN_SCHEMA_VERSION},`);
	});
});

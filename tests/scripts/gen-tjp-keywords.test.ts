// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for the pure helpers of scripts/gen-tjp-keywords.mjs (phase-1 spec 6.3). The
// committed table itself is checked against a booted engine by `npm run gen:keywords -- --check`
// in CI, and by src/lib/tjp/syntax/keywords.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	buildTable,
	compareModule,
	formatModule,
	GLOBAL_CONTEXT,
	OUT,
	PROLOG_CONTEXT,
	renderModule,
} from '../../scripts/gen-tjp-keywords.mjs';
import * as types from '../../src/lib/tjp/syntax/types';

function kw(keyword: string, contexts: string[], scenarioSpecific = false) {
	return {
		keyword,
		contexts,
		syntax: `${keyword.split('.')[0]}  <value>\n`,
		summary: ` Sets ${keyword}. `,
		scenarioSpecific,
	};
}

const minimal = () => [
	kw('project', []),
	kw('macro', ['properties']),
	kw('include.macro', []),
	kw('properties', []),
	kw('task', ['properties', 'task']),
	kw('effort', ['task'], true),
];

const from = { tj: '3.8.4', tjCommit: 'c'.repeat(40), bundleHash: 'b'.repeat(64) };

describe('buildTable', () => {
	it('uses the same context ids as the lookups', () => {
		expect(GLOBAL_CONTEXT).toBe(types.GLOBAL_CONTEXT);
		expect(PROLOG_CONTEXT).toBe(types.PROLOG_CONTEXT);
	});

	it('maps properties to the top level, adds the prolog, sorts and trims', () => {
		const table = buildTable({ tjVersion: '3.8.4', keywords: minimal().reverse() });
		expect(table.map((e) => e.keyword)).toEqual([
			'effort',
			'include.macro',
			'macro',
			'project',
			'properties',
			'task',
		]);
		const get = (id: string) => table.find((e) => e.keyword === id);
		expect(get('task')?.contexts).toEqual(['', 'task']);
		expect(get('macro')?.contexts).toEqual(['', '<prolog>']);
		expect(get('include.macro')).toMatchObject({ name: 'include', contexts: ['<prolog>'] });
		expect(get('project')?.contexts).toEqual(['']);
		expect(get('properties')?.contexts).toEqual([]);
		expect(get('effort')).toEqual({
			keyword: 'effort',
			name: 'effort',
			contexts: ['task'],
			scenarioSpecific: true,
			syntax: 'effort <value>',
			summary: 'Sets effort.',
		});
	});

	it('fails loudly when the engine breaks an assumption', () => {
		const build = (keywords: ReturnType<typeof kw>[]) => () =>
			buildTable({ tjVersion: '3.8.4', keywords });
		expect(build([...minimal(), kw('task', [])])).toThrow(/duplicate/);
		expect(build([...minimal(), kw('note', ['nowhere'])])).toThrow(/unknown context 'nowhere'/);
		expect(build([...minimal(), kw('note.a', ['task']), kw('note.b', ['task'])])).toThrow(
			/'note.a' and 'note.b' are both 'note' in 'task'/,
		);
		expect(build([...minimal(), kw('Bad', ['task'])])).toThrow(/unexpected keyword id/);
		const moved = minimal().map((k) => (k.keyword === 'project' ? kw('project', ['task']) : k));
		expect(build(moved)).toThrow(/review EXTRA_CONTEXTS/);
		expect(build(minimal().filter((k) => k.keyword !== 'macro'))).toThrow(/'macro' has contexts/);
	});
});

describe('renderModule and formatModule', () => {
	it('is deterministic and formatted as the repository formats it', async () => {
		const table = buildTable({ tjVersion: '3.8.4', keywords: minimal() });
		const shuffled = buildTable({ tjVersion: '3.8.4', keywords: minimal().reverse() });
		const a = await formatModule(renderModule(table, from));
		const b = await formatModule(renderModule(shuffled, from));
		expect(a).toBe(b);
		expect(await formatModule(a)).toBe(a);
		expect(a).toMatch(/^\/\/ SPDX-License-Identifier: GPL-2.0-only\n/);
		expect(a).toContain(`// TaskJuggler 3.8.4, commit ${from.tjCommit}`);
		// The provenance line; the word itself would trip scripts/ci/no-ruby.mjs.
		expect(a).toMatch(new RegExp(`^// Engine \\w+ sha256 ${from.bundleHash}$`, 'm'));
		expect(a).toContain("export const TJ_VERSION = '3.8.4';");
	});

	it('leaves the committed table unchanged when formatted again', async () => {
		const committed = readFileSync(new URL(`../../${OUT}`, import.meta.url), 'utf8');
		expect(await formatModule(committed)).toBe(committed);
	});
});

describe('compareModule', () => {
	it('accepts an identical file', () => {
		expect(compareModule('a\nb\n', 'a\nb\n')).toBeNull();
	});

	it('reports a missing file', () => {
		expect(compareModule(null, 'a\n')).toMatch(/missing/);
	});

	it('tells a rebuilt engine apart from a changed table', () => {
		const table = buildTable({ tjVersion: '3.8.4', keywords: minimal() });
		const old = renderModule(table, from);
		const rebuilt = renderModule(table, { ...from, bundleHash: 'd'.repeat(64) });
		expect(compareModule(old, rebuilt)).toMatch(/only the engine provenance/);
		const changed = renderModule(
			buildTable({ tjVersion: '3.8.4', keywords: [...minimal(), kw('length', ['task'])] }),
			from,
		);
		const message = compareModule(old, changed);
		expect(message).toMatch(/the keyword table differs/);
		expect(message).toMatch(/first difference at line \d+/);
	});
});

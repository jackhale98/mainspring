// SPDX-License-Identifier: GPL-2.0-or-later
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../index/build';
import { NO_HINTS } from '../index/hints';
import { inline } from '../index/testing';
import type { KeywordDocsSource } from '../syntax/docs';
import { keywordsInContext } from '../syntax/keywords';
import { idCompletionSource, keywordCompletionSource } from './complete';
import { createWorkspace } from '../../workspace/workspace';
import { tjpEnv, workspaceExtensions } from './index';
import { engineDocs, PLAN, TABLE_ONLY, tjpState, type TestOptions } from './testing';

function complete(
	marked: string,
	opts: TestOptions & { explicit?: boolean; docs?: () => KeywordDocsSource } = {},
): CompletionResult | null {
	const state = tjpState(marked, opts);
	return keywordAt(state, opts.explicit ?? false, opts.docs ?? (() => TABLE_ONLY));
}

function keywordAt(state: EditorState, explicit: boolean, docs: () => KeywordDocsSource) {
	const cx = new CompletionContext(state, state.selection.main.head, explicit);
	const r = keywordCompletionSource(docs)(cx);
	if (r instanceof Promise) throw new Error('expected a synchronous result');
	return r;
}

const labels = (r: CompletionResult | null): string[] => (r ? r.options.map((o) => o.label) : []);

describe('keywordCompletionSource', () => {
	it('offers the keywords of the context at the cursor, from the table', () => {
		const r = complete('task a "A" {\n  ef|\n}\n');
		expect(r?.from).toBe('task a "A" {\n  '.length);
		expect(labels(r)).toEqual(keywordsInContext('task').map((k) => k.name));
		expect(labels(r)).toContain('effort');
		expect(labels(r)).not.toContain('timezone');
		const effort = r?.options.find((o) => o.label === 'effort');
		expect(effort?.detail).toMatch(/^effort /);
		expect(effort?.type).toBe('keyword');
		expect(typeof effort?.info).toBe('string');
	});

	it('uses the top context and nested contexts', () => {
		expect(labels(complete('pro|'))).toContain('project');
		expect(labels(complete('project p "P" 2026-01-01 +1m {\n  ti|\n}\n'))).toContain('timezone');
		expect(labels(complete('ti|', { top: 'project' }))).toContain('timezone');
		expect(labels(complete('ma|', { top: 'prolog' }))).toEqual(['include', 'macro']);
		expect(labels(complete('task a "A" {\n  limits {\n    da|\n  }\n}\n'))).toEqual(
			keywordsInContext('limits.task').map((k) => k.name),
		);
	});

	it('works in an unclosed body at the end of the file', () => {
		expect(labels(complete('task a "A" {\n  ef|'))).toContain('effort');
	});

	it('narrows to scenario-specific keywords after a scenario prefix', () => {
		const r = complete('task a "A" {\n  plan:ef|\n}\n');
		expect(r?.from).toBe('task a "A" {\n  plan:'.length);
		const want = keywordsInContext('task', { scenarioSpecificOnly: true }).map((k) => k.name);
		expect(labels(r)).toEqual(want);
		expect(labels(r)).toContain('effort');
		expect(labels(r)).not.toContain('task');
	});

	it('does not take the braces of macro calls and date expressions for body braces', () => {
		expect(complete('task a "A" {\n  ${m} ef|\n}\n')).toBeNull();
		expect(complete('task a "A" {\n  start %{${s} + 1d} ef|\n}\n')).toBeNull();
		expect(labels(complete('task a "A" {\n  task b "B" { ef|\n  }\n}\n'))).toContain('effort');
		expect(labels(complete('task a "A" {\n  task b "B" {} ef|\n}\n'))).toContain('effort');
	});

	it('offers nothing in strings, comments, unknown bodies and list continuations', () => {
		expect(complete('task a "A ef|" {\n}\n')).toBeNull();
		expect(complete('task a "A" {\n  # ef|\n}\n')).toBeNull();
		expect(complete('task a "A" {\n  Custom x {\n    ef|\n  }\n}\n')).toBeNull();
		expect(complete('task a "A" {\n  depends b,\n    c|\n}\n')).toBeNull();
		expect(complete('task a "A" {\n  effort 5d|\n}\n')).toBeNull();
	});

	it('needs a word unless completion is explicit', () => {
		expect(complete('task a "A" {\n  |\n}\n')).toBeNull();
		expect(labels(complete('task a "A" {\n  |\n}\n', { explicit: true }))).toContain('effort');
	});

	it('shows the full documentation once the engine docs have loaded', () => {
		const docs = engineDocs();
		const r = complete('task a "A" {\n  ef|\n}\n', {
			docs: () => ({ table: TABLE_ONLY.table, engine: docs }),
		});
		expect(r?.options.find((o) => o.label === 'effort')?.info).toBe(
			'Full documentation of effort.',
		);
		const stale = engineDocs('3.7.0');
		const r2 = complete('task a "A" {\n  ef|\n}\n', {
			docs: () => ({ table: TABLE_ONLY.table, engine: stale }),
		});
		expect(r2?.options.find((o) => o.label === 'effort')?.info).not.toBe(
			'Full documentation of effort.',
		);
	});

	it('offers the index scenarios as prefixes where scenario attributes are valid', () => {
		const src =
			'project p "P" 2026-01-05 +1m {\n  scenario plan "Plan" {\n    scenario delayed "Delayed"\n  }\n}\n';
		const ws = inline({ 'plan.tjp': `${src}task a "A" {\n  ef\n}\n` });
		const index = buildIndex(ws.snapshot(), NO_HINTS);
		const r = complete(`${src}task a "A" {\n  de|\n}\n`, { index: () => index });
		expect(labels(r)).toEqual(expect.arrayContaining(['plan:', 'delayed:']));
		expect(r?.options.find((o) => o.label === 'delayed:')?.info).toBe('Delayed');
		const inLimits = labels(
			complete(`${src}task a "A" {\n  limits {\n    da|\n  }\n}\n`, { index: () => index }),
		);
		const scenarioLimits = keywordsInContext('limits.task').some((k) => k.scenarioSpecific);
		expect(inLimits.includes('delayed:')).toBe(scenarioLimits);
	});
});

describe('idCompletionSource', () => {
	const ws = inline({ 'plan.tjp': PLAN });
	const index = buildIndex(ws.snapshot(), NO_HINTS);

	function ids(marked: string, on?: boolean): string[] {
		const opts = on === undefined ? { index: () => index } : { index: () => index, ids: on };
		const state = tjpState(marked, opts);
		const r = idCompletionSource()(new CompletionContext(state, state.selection.main.head, false));
		if (r instanceof Promise) throw new Error('expected a synchronous result');
		return labels(r);
	}

	it('offers task ids after depends and precedes, resource ids after allocate', () => {
		expect(ids('task c "C" {\n  depends a|\n}\n')).toEqual(['a', 'b']);
		expect(ids('task c "C" {\n  depends a, b|\n}\n')).toEqual(['a', 'b']);
		expect(ids('task c "C" {\n  depends a,\n    b|\n}\n')).toEqual(['a', 'b']);
		expect(ids('task c "C" {\n  allocate d|\n}\n')).toEqual(['dev']);
		expect(ids('task c "C" {\n  responsible d|\n}\n')).toEqual(['dev']);
	});

	it('is on by default (ADR-0004), off with ids: false, and quiet elsewhere', () => {
		expect(ids('task c "C" {\n  depends a|\n}\n')).toEqual(['a', 'b']);
		expect(ids('task c "C" {\n  depends a|\n}\n', false)).toEqual([]);
		expect(ids('task c "C" {\n  effort 1|\n}\n')).toEqual([]);
		expect(ids('task c "C" {\n  dep|\n}\n')).toEqual([]);
		expect(ids('task c "C" {\n  depends !a|\n}\n')).toEqual([]);
	});
});

describe('workspaceExtensions', () => {
	it('configures each file with its path and top context, and follows context changes', () => {
		const ws = createWorkspace(
			{
				entry: 'plan.tjp',
				files: {
					'plan.tjp': 'project p "P" 2026-01-05 +1m {\n  include "inc.tji"\n}\n',
					'inc.tji': 'timezone "UTC"\n',
				},
			},
			{ extensions: workspaceExtensions({ docs: () => TABLE_ONLY, theme: false }) },
		);
		const env = (path: string) => ws.state(path).facet(tjpEnv);
		expect(env('inc.tji')).toMatchObject({ path: 'inc.tji', top: 'project' });
		expect(env('plan.tjp')).toMatchObject({ path: 'plan.tjp', top: 'global' });
		const plan = ws.state('plan.tjp');
		const at = plan.doc.toString().indexOf('  include');
		ws.commit(
			'plan.tjp',
			plan.update({ changes: { from: at, to: at + '  include "inc.tji"\n'.length } }),
			'typing',
		);
		expect(env('inc.tji').top).toBe('global');
	});
});

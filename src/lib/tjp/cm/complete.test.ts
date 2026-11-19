// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import {
	CompletionContext,
	type Completion,
	type CompletionResult,
} from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorStrings as S } from '../../strings';
import { DOCS_WAIT_MS } from './docs-wait';
import { buildIndex } from '../index/build';
import { NO_HINTS } from '../index/hints';
import { inline } from '../index/testing';
import { keywordDoc, type KeywordDocsSource } from '../syntax/docs';
import { keywordsInContext } from '../syntax/keywords';
import { idCompletionSource, keywordCompletionSource } from './complete';
import { createWorkspace } from '../../workspace/workspace';
import { tjpEnv, workspaceExtensions } from './index';
import { engineDocs, PLAN, slowDocs, TABLE_ONLY, tjpState, type TestOptions } from './testing';

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
		// Before the engine's docs are in, the info waits for them (ADR-0017; tested below).
		expect(typeof effort?.info).toBe('function');
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
			docs: () => ({ table: TABLE_ONLY.table, engine: docs, loading: false }),
		});
		expect(r?.options.find((o) => o.label === 'effort')?.info).toBe(
			'Full documentation of effort.',
		);
		const stale = engineDocs('3.7.0');
		const r2 = complete('task a "A" {\n  ef|\n}\n', {
			docs: () => ({ table: TABLE_ONLY.table, engine: stale, loading: false }),
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

describe('completion info before the docs arrive (ADR-0017)', () => {
	const marked = 'task a "A" {\n  ef|\n}\n';
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	/** The effort option offered with this loader, and its info pane once asked for. */
	function effortWith(fake: ReturnType<typeof slowDocs>) {
		const state = tjpState(marked, { docs: fake.docs, loadDocs: fake.loadDocs });
		const option = keywordAt(state, false, fake.docs)?.options.find((o) => o.label === 'effort');
		if (!option) throw new Error('expected effort');
		return {
			option,
			info(): Promise<Node | null> {
				const info = option.info;
				if (typeof info !== 'function') throw new Error('expected an info function');
				return Promise.resolve(info(option as Completion)).then((r) =>
					r && 'nodeType' in r ? r : (r?.dom ?? null),
				);
			},
		};
	}
	const notes = (n: Node | null): string[] =>
		n instanceof Element
			? [...n.querySelectorAll('.cm-tjp-hover-note')].map((e) => e.textContent ?? '')
			: [];
	const summary = keywordDoc(TABLE_ONLY, 'effort')?.summary ?? '';

	it('gives the full doc on the first info when the docs come within the bound', async () => {
		const fake = slowDocs(DOCS_WAIT_MS - 100);
		const effort = effortWith(fake);
		const pane = effort.info();
		expect(fake.loads).toBe(1);
		await vi.advanceTimersByTimeAsync(DOCS_WAIT_MS - 100);
		const node = await pane;
		expect(node?.textContent).toBe('Full documentation of effort.');
		expect(notes(node)).toEqual([]);
		// Offered again once the docs are in, the info is the full doc itself.
		expect(effortWith(fake).option.info).toBe('Full documentation of effort.');
	});

	it('gives the summary with the loading note past the bound', async () => {
		const effort = effortWith(slowDocs(5_000));
		let settled = false;
		const pane = effort.info().then((n) => ((settled = true), n));
		await vi.advanceTimersByTimeAsync(DOCS_WAIT_MS - 1);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		const node = await pane;
		expect(notes(node)).toEqual([S.hover.docsLoading]);
		expect(node?.firstChild?.textContent).toBe(summary);
	});

	it('gives the summary with no note when the docs are unavailable', async () => {
		const fake = slowDocs(50, 'unavailable');
		const effort = effortWith(fake);
		const pane = effort.info();
		await vi.advanceTimersByTimeAsync(50);
		const node = await pane;
		expect(node?.nodeType).toBe(Node.TEXT_NODE);
		expect(node?.textContent).toBe(summary);
		expect(notes(node)).toEqual([]);
		// The next info asks again.
		void effort.info();
		expect(fake.loads).toBe(2);
	});

	it('gives the summary as a plain string while the loader rests after a failure', async () => {
		const fake = slowDocs(50, 'unavailable', 5_000);
		const pane = effortWith(fake).info();
		await vi.advanceTimersByTimeAsync(50);
		await pane;
		// A string info: CodeMirror shows it at once and links it with aria-describedby.
		for (let i = 0; i < 5; i++) expect(effortWith(fake).option.info).toBe(summary);
		expect(fake.loads).toBe(1);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(typeof effortWith(fake).option.info).toBe('function');
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

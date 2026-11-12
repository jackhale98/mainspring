// SPDX-License-Identifier: GPL-2.0-or-later
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { editorStrings as S } from '../../strings';
import { createWorkspace, type Workspace } from '../../workspace/workspace';
import { buildIndex } from '../index/build';
import { NO_HINTS } from '../index/hints';
import type { SymbolIndex } from '../index/types';
import type { KeywordDocsSource } from '../syntax/docs';
import { hoverContent, hoverInfo, keywordAtCursor } from './hover';
import { workspaceExtensions } from './index';
import { engineDocs, PLAN, TABLE_ONLY, tjpState } from './testing';

const table = (): KeywordDocsSource => TABLE_ONLY;
const loaded = (): KeywordDocsSource => ({ table: TABLE_ONLY.table, engine: engineDocs() });

describe('keyword hover', () => {
	const doc = 'resource r "R" {\n  booking t 2026-01-05 +1d\n}\ntask t "T" {\n  effort 5d\n}\n';
	const state = tjpState(doc);
	const at = (word: string): number => doc.indexOf(word) + 2;

	it('shows the table entry at once, resolved in the statement context', () => {
		const info = hoverInfo(state, at('booking'), table);
		expect(info?.kind).toBe('keyword');
		if (info?.kind !== 'keyword') return;
		expect(info.doc.keyword).toBe('booking.resource');
		expect([info.from, info.to]).toEqual([doc.indexOf('booking'), doc.indexOf('booking') + 7]);
		const c = hoverContent(info);
		expect(c.title).toBe('booking');
		expect(c.code).toBe(info.doc.syntax);
		expect(c.body).toBe(info.doc.summary);
		expect(c.notes).toContain(S.hover.docsLoading);
	});

	it('shows the engine documentation once it has loaded', () => {
		const info = hoverInfo(state, at('effort'), loaded);
		if (info?.kind !== 'keyword') throw new Error('expected a keyword');
		const c = hoverContent(info);
		expect(c.body).toBe('Full documentation of effort.');
		expect(c.seeAlso).toEqual(['duration', 'length']);
		expect(c.notes).not.toContain(S.hover.docsLoading);
		expect(c.notes).toContain(S.hover.scenarioSpecific);
	});

	it('ignores engine docs of another TaskJuggler version', () => {
		const other = (): KeywordDocsSource => ({
			table: TABLE_ONLY.table,
			engine: engineDocs('3.7.0'),
		});
		const info = hoverInfo(state, at('effort'), other);
		if (info?.kind !== 'keyword') throw new Error('expected a keyword');
		expect(info.doc.doc).toBeNull();
	});

	it('shows nothing on values, strings and whitespace without an index', () => {
		expect(hoverInfo(state, doc.indexOf('5d') + 1, table)).toBeNull();
		expect(hoverInfo(state, doc.indexOf('"T"') + 1, table)).toBeNull();
		expect(hoverInfo(state, doc.indexOf('t "T"'), table)).toBeNull();
	});
});

describe('keywordAtCursor', () => {
	it('gives the keyword under the cursor, else the one leading the statement', () => {
		const doc = 'task t "T" {\n  effort 5d\n}\n';
		const s = (pos: number): EditorState =>
			tjpState(doc).update({ selection: EditorSelection.cursor(pos) }).state;
		expect(keywordAtCursor(s(doc.indexOf('effort') + 3))?.keyword).toBe('effort');
		expect(keywordAtCursor(s(doc.indexOf('5d') + 1))?.keyword).toBe('effort');
		expect(keywordAtCursor(s(doc.indexOf('"T"')))?.keyword).toBe('task');
		expect(keywordAtCursor(s(doc.length))).toBeNull();
	});
});

describe('id hover', () => {
	let ws: Workspace | null = null;
	let index: SymbolIndex | null = null;
	ws = createWorkspace(
		{ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } },
		{
			extensions: workspaceExtensions({
				docs: table,
				theme: false,
				workspace: () => ws,
				index: () => index,
			}),
		},
	);
	const workspace = ws;
	index = buildIndex(workspace.snapshot(), NO_HINTS);
	const state = (): EditorState => {
		const s = workspace.state('plan.tjp');
		ensureSyntaxTree(s, s.doc.length, 5000);
		return s;
	};

	it('shows the declaration of a referenced task and resource', () => {
		const dep = PLAN.indexOf('depends a') + 'depends '.length;
		const info = hoverInfo(state(), dep, table);
		expect(info).toMatchObject({ kind: 'symbol', of: 'task', id: 'a', name: 'A' });
		if (info?.kind !== 'symbol') return;
		expect(info.decl).toEqual({ file: 'plan.tjp', line: 5, header: 'task a "A"' });
		const c = hoverContent(info);
		expect(c.title).toBe(S.hover.symbolTitle(S.hover.task, 'a', 'A'));
		expect(c.notes).toEqual([S.hover.declaredAt('plan.tjp', 5)]);
		const alloc = PLAN.lastIndexOf('allocate dev') + 'allocate '.length + 1;
		expect(hoverInfo(state(), alloc, table)).toMatchObject({
			kind: 'symbol',
			of: 'resource',
			id: 'dev',
		});
	});

	it('shows a declaration header itself, and nothing in a body', () => {
		expect(hoverInfo(state(), PLAN.indexOf('task b') + 5, table)).toMatchObject({
			kind: 'symbol',
			id: 'b',
		});
		expect(hoverInfo(state(), PLAN.indexOf('  allocate dev') - 1, table)).toBeNull();
	});

	it('gives no id hover while the index is behind the text', () => {
		const s = workspace.state('plan.tjp');
		workspace.commit('plan.tjp', s.update({ changes: { from: 0, insert: '# x\n' } }), 'typing');
		const dep = PLAN.indexOf('depends a') + 'depends '.length + 4;
		expect(hoverInfo(state(), dep, table)).toBeNull();
		index = buildIndex(workspace.snapshot(), NO_HINTS);
		expect(hoverInfo(state(), dep, table)).toMatchObject({ kind: 'symbol', id: 'a' });
	});

	it('reports a reference to an undeclared id', () => {
		const s = workspace.state('plan.tjp');
		const at = s.doc.toString().indexOf('depends a') + 'depends '.length;
		workspace.commit(
			'plan.tjp',
			s.update({ changes: { from: at, to: at + 1, insert: 'zz' } }),
			'typing',
		);
		index = buildIndex(workspace.snapshot(), NO_HINTS);
		const info = hoverInfo(state(), at + 1, table);
		expect(info).toMatchObject({ kind: 'unresolved', of: 'task', written: 'zz' });
		if (info) expect(hoverContent(info).body).toBe(S.hover.unknownTarget('zz'));
	});
});

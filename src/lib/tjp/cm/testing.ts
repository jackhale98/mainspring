// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the editor extensions: states with the full `tjp()` set (no DOM), parsed in
 * full, and documents written with a `|` marking the cursor.
 */
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import type { SyntaxDocs } from '../../../engine/protocol';
import { KEYWORDS } from '../syntax/keywords';
import type { KeywordDocsSource } from '../syntax/docs';
import { tjp, type TjpExtensionOptions } from './index';

export const TABLE_ONLY: KeywordDocsSource = { table: KEYWORDS, engine: null };

/** Engine docs for a few keywords, as `syntax()` would return them. */
export function engineDocs(tjVersion = '3.8.4'): SyntaxDocs {
	return {
		tjVersion,
		keywords: KEYWORDS.slice(0, 400).map((k) => ({
			keyword: k.keyword,
			contexts: [...k.contexts],
			syntax: k.syntax,
			summary: k.summary,
			doc: `Full documentation of ${k.keyword}.`,
			scenarioSpecific: k.scenarioSpecific,
			seeAlso: k.keyword === 'effort' ? ['duration', 'length'] : [],
		})),
	};
}

/** Splits `a|b` into the text and the cursor offset (the end when there is no `|`). */
export function cursorDoc(marked: string): { doc: string; pos: number } {
	const pos = marked.indexOf('|');
	return pos < 0 ? { doc: marked, pos: marked.length } : { doc: marked.replace('|', ''), pos };
}

export type TestOptions = Partial<TjpExtensionOptions> & { extra?: Extension };

/** A state with the TJP extensions over `marked` (cursor at `|`), parsed to the end. */
export function tjpState(marked: string, opts: TestOptions = {}): EditorState {
	const { doc, pos } = cursorDoc(marked);
	const { extra, ...rest } = opts;
	const state = EditorState.create({
		doc,
		selection: EditorSelection.cursor(pos),
		extensions: [
			tjp({ top: 'global', docs: () => TABLE_ONLY, theme: false, ...rest }),
			extra ?? [],
		],
	});
	ensureSyntaxTree(state, state.doc.length, 10_000);
	return state;
}

/** A small valid plan used across the tests. */
export const PLAN = [
	'project p "P" 2026-01-05 +2m {',
	'  timezone "UTC"',
	'}',
	'resource dev "Developer"',
	'task a "A" {',
	'  effort 5d',
	'  allocate dev',
	'}',
	'task b "B" {',
	'  depends a',
	'  allocate dev',
	'}',
	'',
].join('\n');

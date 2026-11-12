// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The TJP language for CodeMirror (phase-1.md 6.7): one `LRLanguage` per top context (spec 5.2),
 * so a file included inside the project header or before it parses as TaskJuggler reads it.
 * Highlighting comes from the grammar's `styleTags` (grammar/highlight.ts, already in the
 * parser); this adds folding of bodies, block comments and multi-line macro bodies, `#` line
 * comments and C block comments for the comment commands, and re-indentation when a line's
 * `}` is typed.
 *
 * The editor's tree is CodeMirror's own incremental parse of the state's document. The
 * workspace keeps a second tree per file (document.ts `updateFile`, with `reuseFragments`);
 * diagnostics, the index and formatting use that one, and so does this layer where it can
 * (hover on ids, the format command).
 */
import { foldInside, foldNodeProp, LanguageSupport, LRLanguage } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { TopContext } from '../document';
import { tjpParser } from '../grammar/parser';

/** Fold a token's inside, keeping `open` and `close` characters visible; null if one line. */
function foldToken(open: number, close: number) {
	return (node: SyntaxNode, state: EditorState): { from: number; to: number } | null => {
		const from = node.from + open;
		const to = node.to - close;
		if (to <= from) return null;
		return state.doc.lineAt(from).number === state.doc.lineAt(to).number ? null : { from, to };
	};
}

const foldProps = foldNodeProp.add({
	Body: foldInside,
	BlockComment: foldToken(2, 2),
	MacroBody: foldToken(1, 1),
});

const LANGUAGE_DATA = {
	commentTokens: { line: '#', block: { open: '/*', close: '*/' } },
	indentOnInput: /^\s*\}$/,
	closeBrackets: { brackets: ['(', '[', '{', '"', "'"] },
	wordChars: '_',
};

const languages = new Map<TopContext, LRLanguage>();

/** The TJP language for files whose top level is `top`. */
export function tjpLanguage(top: TopContext = 'global'): LRLanguage {
	let lang = languages.get(top);
	if (!lang) {
		lang = LRLanguage.define({
			name: top === 'global' ? 'tjp' : `tjp-${top}`,
			parser: tjpParser(top).configure({ props: [foldProps] }),
			languageData: LANGUAGE_DATA,
		});
		languages.set(top, lang);
	}
	return lang;
}

/** The language with no support extensions (`tjp()` adds completion, hover and the rest). */
export function tjpLanguageSupport(top: TopContext = 'global'): LanguageSupport {
	return new LanguageSupport(tjpLanguage(top));
}

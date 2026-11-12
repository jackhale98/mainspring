// SPDX-License-Identifier: GPL-2.0-or-later
import { toggleComment } from '@codemirror/commands';
import { foldable, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import { codemirrorPhrases } from '../../strings';
import { highlightTree } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import { tjpLanguage, tjpLanguageSupport } from './language';
import { tjpHighlightStyle } from './theme';
import { tjpState } from './testing';

function run(state: EditorState, cmd: typeof toggleComment): EditorState {
	let out = state;
	cmd({ state, dispatch: (tr: Transaction) => (out = tr.state) });
	return out;
}

describe('tjpLanguage', () => {
	it('has one language per top context, parsing with that context', () => {
		expect(tjpLanguage('global')).toBe(tjpLanguage());
		expect(tjpLanguage('project')).not.toBe(tjpLanguage('global'));
		expect(tjpLanguageSupport('prolog').language).toBe(tjpLanguage('prolog'));
		const inProject = tjpState('timezone "UTC"\n', { top: 'project' });
		const inGlobal = tjpState('timezone "UTC"\n');
		expect(syntaxTree(inProject).toString()).not.toMatch(/⚠/);
		expect(syntaxTree(inGlobal).toString()).toMatch(/⚠/);
	});

	it('folds multi-line bodies, block comments and macro bodies, not one-line ones', () => {
		const doc =
			'task a "A" {\n  effort 5d\n}\ntask b "B" { effort 1d }\n/* one\n two */\nmacro m [\n  x\n]\n';
		const s = tjpState(doc);
		const fold = (line: number) => {
			const l = s.doc.line(line);
			return foldable(s, l.from, l.to);
		};
		expect(fold(1)).toEqual({ from: doc.indexOf('{') + 1, to: doc.indexOf('}') });
		expect(fold(4)).toBeNull();
		expect(fold(5)).toEqual({ from: doc.indexOf('/*') + 2, to: doc.indexOf('*/') });
		expect(fold(7)).toEqual({ from: doc.indexOf('[') + 1, to: doc.lastIndexOf(']') });
	});

	it('toggles # line comments', () => {
		const s = tjpState('task a "A" {\n  effort 5d\n}\n');
		const line = s.doc.line(2);
		const sel = s.update({ selection: EditorSelection.cursor(line.from + 3) }).state;
		const once = run(sel, toggleComment);
		expect(once.doc.line(2).text).toBe('  # effort 5d');
		expect(run(once, toggleComment).doc.line(2).text).toBe('  effort 5d');
	});

	it('keeps CR characters in the text (line separator \\n only)', () => {
		const doc = 'task a "A" {\r\n  effort 5d\r\n}\r\n';
		const s = tjpState(doc);
		expect(s.doc.toString()).toBe(doc);
		expect(s.doc.lines).toBe(4);
		const t = s.update({ changes: { from: 0, insert: 'x\r\ny' } }).state;
		expect(t.doc.toString()).toBe(`x\r\ny${doc}`);
	});

	it('highlights through the grammar style tags', () => {
		const doc = 'task a "A" {\n  effort 5d # c\n  depends b\n}\n';
		const s = tjpState(doc);
		const classes = new Map<string, string>();
		highlightTree(syntaxTree(s), tjpHighlightStyle, (from, to, cls) => {
			classes.set(doc.slice(from, to), cls);
		});
		const kw = classes.get('task');
		expect(kw).toBeTruthy();
		expect(classes.get('effort')).toBe(kw);
		expect(classes.get('"A"')).toBeTruthy();
		expect(classes.get('# c')).toBeTruthy();
		expect(classes.get('a')).not.toBe(classes.get('b'));
		expect(new Set([kw, classes.get('"A"'), classes.get('# c'), classes.get('5')]).size).toBe(4);
	});
});

describe('phrases', () => {
	it("route CodeMirror's own text through strings.ts", () => {
		const s = tjpState('x');
		expect(s.facet(EditorState.phrases)).toContainEqual(codemirrorPhrases);
		expect(s.phrase('No diagnostics')).toBe(codemirrorPhrases['No diagnostics']);
	});
});

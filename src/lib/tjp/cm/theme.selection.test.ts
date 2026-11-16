// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// Selected text is marked inline, above the active line's and the selected source's backgrounds,
// so a selection always shows (user, 2026-11-16).
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { SELECTED_CLASS, tjpTheme } from './theme';

describe('selectionMarks', () => {
	it('marks exactly the selected text, and nothing for a cursor', () => {
		const view = new EditorView({
			state: EditorState.create({ doc: 'task a "A"\ntask b "B"\n', extensions: [tjpTheme()] }),
		});
		const marked = (): string[] =>
			[...view.contentDOM.querySelectorAll(`.${SELECTED_CLASS}`)].map((e) => e.textContent ?? '');
		expect(marked()).toEqual([]);
		view.dispatch({ selection: EditorSelection.range(5, 6) });
		expect(marked()).toEqual(['a']);
		view.dispatch({ selection: EditorSelection.range(11, 21) });
		expect(marked()).toEqual(['task b "B"']);
		view.dispatch({ selection: EditorSelection.cursor(3) });
		expect(marked()).toEqual([]);
		view.destroy();
	});
});

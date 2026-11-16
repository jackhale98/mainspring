// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The editor marks itself while text is selected, so the active line and the selected source drop
// their backgrounds and the selection layer behind them shows (user, 2026-11-16).
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { HAS_SELECTION_CLASS, tjpTheme } from './theme';

describe('selectionMarker', () => {
	it('marks the editor only while some text is selected, so line backgrounds step aside', () => {
		const view = new EditorView({
			state: EditorState.create({ doc: 'task a "A"\ntask b "B"\n', extensions: [tjpTheme()] }),
		});
		expect(view.dom.classList.contains(HAS_SELECTION_CLASS)).toBe(false);
		view.dispatch({ selection: EditorSelection.range(0, 4) });
		expect(view.dom.classList.contains(HAS_SELECTION_CLASS)).toBe(true);
		view.dispatch({ selection: EditorSelection.cursor(3) });
		expect(view.dom.classList.contains(HAS_SELECTION_CLASS)).toBe(false);
		view.destroy();
	});
});

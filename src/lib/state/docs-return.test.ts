// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The editor after the docs sheet (docs-return.ts): focused again at the same cursor when it had the
// focus when the sheet opened; nothing when it had not (a mouse's Docs button took the focus itself).
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { restoreEditor } from './docs-return';

const DOC = 'project p "P" 2026-01-05 +1m\ntask a "Alpha" { effort 1d }\n';
let view: EditorView | null = null;
afterEach(() => {
	view?.destroy();
	view = null;
	document.body.replaceChildren();
});

function editor(): EditorView {
	view = new EditorView({
		state: EditorState.create({ doc: DOC, selection: EditorSelection.cursor(36) }),
		parent: document.body.appendChild(document.createElement('div')),
	});
	return view;
}

describe('restoreEditor', () => {
	it('focuses the editor and puts the cursor back where it was', () => {
		const v = editor();
		const was = v.state.selection;
		v.dispatch({ selection: EditorSelection.cursor(3) });
		restoreEditor(v, was);
		expect(v.hasFocus).toBe(true);
		expect(v.state.selection.main.head).toBe(36);
	});

	it('leaves the focus alone when the editor had none', () => {
		const v = editor();
		const button = document.body.appendChild(document.createElement('button'));
		button.focus();
		restoreEditor(v, null);
		expect(document.activeElement).toBe(button);
	});

	it('does not put a cursor past the end of a text that has got shorter', () => {
		const v = editor();
		const was = EditorSelection.single(500);
		restoreEditor(v, was);
		expect(v.state.selection.main.head).toBe(36);
		expect(v.hasFocus).toBe(true);
	});
});

// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The selected-source highlight (phase-2.md 6.10): the span field and its mapping through edits and
// the line class on the lines of the span. The annotation that keeps the app's own transactions
// out of the cursor callback is tested with the editor controller (editor-mark.test.ts).
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
	SOURCE_CLASS,
	setSourceHighlight,
	sourceHighlight,
	sourceHighlightField,
} from './source-highlight';

const DOC = ['one', 'two', 'three', 'four', 'five'].join('\n');
let view: EditorView | null = null;

function make(doc = DOC): EditorView {
	const parent = document.createElement('div');
	document.body.appendChild(parent);
	view = new EditorView({
		parent,
		state: EditorState.create({ doc, extensions: sourceHighlight() }),
	});
	return view;
}

afterEach(() => {
	view?.dom.remove();
	view?.destroy();
	view = null;
});

const lit = (v: EditorView): string[] =>
	[...v.dom.querySelectorAll(`.cm-line.${SOURCE_CLASS}`)].map((l) => l.textContent ?? '');

describe('sourceHighlight', () => {
	it('draws the class on every line the span touches, and clears it', () => {
		const v = make();
		expect(lit(v)).toEqual([]);
		// From the middle of "two" to the middle of "four": whole lines.
		v.dispatch({ effects: setSourceHighlight.of({ from: 5, to: 16 }) });
		expect(lit(v)).toEqual(['two', 'three', 'four']);
		v.dispatch({ effects: setSourceHighlight.of(null) });
		expect(lit(v)).toEqual([]);
	});

	it('maps the span through edits: text typed in it joins it, text around it does not', () => {
		const v = make();
		v.dispatch({ effects: setSourceHighlight.of({ from: 4, to: 13 }) }); // two and three
		v.dispatch({ changes: { from: 0, insert: 'zero\n' } });
		expect(v.state.field(sourceHighlightField)).toEqual({ from: 9, to: 18 });
		expect(lit(v)).toEqual(['two', 'three']);
		// A line typed inside it is in it; one typed right after its end is not.
		v.dispatch({ changes: { from: 13, insert: 'mid\n' } });
		expect(lit(v)).toEqual(['two', 'mid', 'three']);
		const end = v.state.field(sourceHighlightField)?.to ?? 0;
		v.dispatch({ changes: { from: end, insert: '!' } });
		expect(lit(v)).toEqual(['two', 'mid', 'three!']);
		expect(v.state.field(sourceHighlightField)?.to).toBe(end);
	});

	it('drops a span that an edit deletes', () => {
		const v = make();
		v.dispatch({ effects: setSourceHighlight.of({ from: 4, to: 7 }) });
		v.dispatch({ changes: { from: 3, to: 8 } });
		expect(v.state.field(sourceHighlightField)).toBeNull();
		expect(lit(v)).toEqual([]);
	});
});

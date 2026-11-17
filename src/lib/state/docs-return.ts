// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where the editor goes back to when the docs sheet closes. A finger's Docs button does not take the
 * focus, so the editor still had it (and the keyboard) when the sheet opened; the sheet's opening
 * let the keyboard go (lib/ui/keyboard.ts). When the sheet has gone the editor has the focus again,
 * at the cursor it had, which brings the keyboard back. In the docs sheet's chunk, not the first load.
 */
import type { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Gives `view` its cursor (if it moved and still fits the text) and the focus; null: it had none. */
export function restoreEditor(view: EditorView | null, was: EditorSelection | null): void {
	if (!view || !was) return;
	if (!view.state.selection.eq(was) && was.ranges.every((r) => r.to <= view.state.doc.length)) {
		view.dispatch({ selection: was });
	}
	view.focus();
}

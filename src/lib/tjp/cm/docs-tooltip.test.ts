// SPDX-License-Identifier: GPL-2.0-or-later
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { showTooltip, type EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { editorStrings as S } from '../../strings';
import { docsAtCursor, docsTooltipField, hideDocsCommand, showDocsCommand } from './docs-tooltip';
import { tjpKeymap } from './commands';
import { tjpState } from './testing';

class View {
	constructor(public state: EditorState) {}
	dispatch(spec: TransactionSpec): void {
		this.state = this.state.update(spec).state;
	}
	asView(): EditorView {
		return this as unknown as EditorView;
	}
}

const DOC = 'task t "T" {\n  effort 5d\n}\n';

describe('docs at the cursor', () => {
	it('shows the keyword docs at the cursor, or the statement keyword', () => {
		const at = (pos: number) =>
			docsAtCursor(tjpState(DOC).update({ selection: EditorSelection.cursor(pos) }).state);
		expect(at(DOC.indexOf('effort') + 2).title).toBe('effort');
		expect(at(DOC.indexOf('5d') + 1).title).toBe('effort');
		expect(at(DOC.indexOf('effort') + 6).title).toBe('effort');
		expect(at(DOC.length).title).toBe(S.hover.noDocs);
	});

	it('opens a tooltip by keyboard and closes it on Escape or when the cursor moves', () => {
		const view = new View(tjpState(`task t "T" {\n  eff|ort 5d\n}\n`));
		expect(hideDocsCommand(view.asView())).toBe(false);
		expect(showDocsCommand(view.asView())).toBe(true);
		expect(view.state.field(docsTooltipField)?.content.title).toBe('effort');
		expect(view.state.facet(showTooltip).filter((t) => t !== null)).toHaveLength(1);
		expect(hideDocsCommand(view.asView())).toBe(true);
		expect(view.state.field(docsTooltipField)).toBeNull();
		showDocsCommand(view.asView());
		view.dispatch({ selection: { anchor: 0 } });
		expect(view.state.field(docsTooltipField)).toBeNull();
	});

	it('is bound to Mod-k Mod-i, Escape closes', () => {
		expect(tjpKeymap.find((k) => k.run === showDocsCommand)?.key).toBe('Mod-k Mod-i');
		expect(tjpKeymap.find((k) => k.run === hideDocsCommand)?.key).toBe('Escape');
	});
});

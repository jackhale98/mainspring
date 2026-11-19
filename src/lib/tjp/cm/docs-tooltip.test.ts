// SPDX-License-Identifier: GPL-2.0-or-later
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { showTooltip, type EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorStrings as S } from '../../strings';
import type { KeywordDocsSource } from '../syntax/docs';
import {
	docsAtCursor,
	docsAtCursorWithin,
	docsTooltipField,
	hideDocsCommand,
	showDocsCommand,
} from './docs-tooltip';
import { DOCS_WAIT_MS } from './docs-wait';
import { tjpKeymap } from './commands';
import { engineDocs, slowDocs, TABLE_ONLY, tjpState } from './testing';

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

	it('opens a tooltip by keyboard and closes it on Escape or when the cursor moves', async () => {
		// The engine's docs are in, so the command shows the tooltip at once.
		const loaded = (): KeywordDocsSource => ({ ...TABLE_ONLY, engine: engineDocs() });
		const view = new View(tjpState(`task t "T" {\n  eff|ort 5d\n}\n`, { docs: loaded }));
		expect(hideDocsCommand(view.asView())).toBe(false);
		expect(showDocsCommand(view.asView())).toBe(true);
		expect(view.state.field(docsTooltipField)?.content.title).toBe('effort');
		expect(view.state.field(docsTooltipField)?.content.body).toBe('Full documentation of effort.');
		expect(view.state.facet(showTooltip).filter((t) => t !== null)).toHaveLength(1);
		expect(hideDocsCommand(view.asView())).toBe(true);
		expect(view.state.field(docsTooltipField)).toBeNull();
		showDocsCommand(view.asView());
		view.dispatch({ selection: { anchor: 0 } });
		expect(view.state.field(docsTooltipField)).toBeNull();
	});
});

describe('docs at the cursor before the docs arrive (ADR-0017)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});
	const marked = `task t "T" {\n  eff|ort 5d\n}\n`;

	it('waits for the docs within the bound, else shows the summary with the loading note', async () => {
		const quick = slowDocs(DOCS_WAIT_MS - 100);
		const soon = docsAtCursorWithin(tjpState(marked, quick));
		await vi.advanceTimersByTimeAsync(DOCS_WAIT_MS - 100);
		expect((await soon).body).toBe('Full documentation of effort.');

		const slow = slowDocs(5_000);
		const late = docsAtCursorWithin(tjpState(marked, slow));
		await vi.advanceTimersByTimeAsync(DOCS_WAIT_MS);
		const content = await late;
		expect(content.title).toBe('effort');
		expect(content.notes).toContain(S.hover.docsLoading);
		expect(content.body).not.toBe('Full documentation of effort.');

		const gone = slowDocs(50, 'unavailable');
		const none = docsAtCursorWithin(tjpState(marked, gone));
		await vi.advanceTimersByTimeAsync(50);
		expect((await none).notes).not.toContain(S.hover.docsLoading);
	});

	it('shows the keyboard tooltip once the wait ends, unless the cursor has moved', async () => {
		const view = new View(tjpState(marked, slowDocs(100)));
		expect(showDocsCommand(view.asView())).toBe(true);
		expect(view.state.field(docsTooltipField)).toBeNull();
		await vi.advanceTimersByTimeAsync(100);
		expect(view.state.field(docsTooltipField)?.content.body).toBe('Full documentation of effort.');

		const moved = new View(tjpState(marked, slowDocs(100)));
		showDocsCommand(moved.asView());
		moved.dispatch({ selection: { anchor: 0 } });
		await vi.advanceTimersByTimeAsync(100);
		expect(moved.state.field(docsTooltipField)).toBeNull();
	});

	it('drops a show that is still waiting when Escape closes the docs', async () => {
		const view = new View(tjpState(marked, slowDocs(100)));
		expect(showDocsCommand(view.asView())).toBe(true);
		// Nothing is open yet, so Escape keeps its usual work, but the pending show is dropped.
		expect(hideDocsCommand(view.asView())).toBe(false);
		await vi.advanceTimersByTimeAsync(100);
		expect(view.state.field(docsTooltipField)).toBeNull();
		// A new request after that shows again.
		showDocsCommand(view.asView());
		expect(view.state.field(docsTooltipField)?.content.body).toBe('Full documentation of effort.');
	});

	it('is bound to Mod-k Mod-i, Escape closes', () => {
		expect(tjpKeymap.find((k) => k.run === showDocsCommand)?.key).toBe('Mod-k Mod-i');
		expect(tjpKeymap.find((k) => k.run === hideDocsCommand)?.key).toBe('Escape');
	});
});

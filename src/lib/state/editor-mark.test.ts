// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The editor's side of selection sync (phase-2.md 6.10): the selected-source highlight a visual
// selection draws, the cursor that moves only without the focus, the app's own transactions that
// never come back as a selection from the text, the cursor callback (a click at once, typing
// after a pause), and the wait on a held Android key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { SOURCE_CLASS, sourceHighlightField, workspaceExtensions } from '../tjp/cm';
import { createWorkspace, type Workspace } from '../workspace/workspace';
import { EditorController, TYPING_QUIET_MS } from './editor-controller';
import type { SourceMark } from './selection.svelte';
import { editorSetup } from './editor-setup';

const PLAN = [
	'project p "P" 2026-01-05 +1m',
	'task a "A" {',
	'  effort 1d',
	'}',
	'task b "B" {',
	'  effort 2d',
	'}',
	'include "x.tji"',
	'',
].join('\n');

let ws: Workspace;
let ctl: EditorController;
let host: HTMLElement;
let cursor: Array<[string, number]>;

beforeEach(() => {
	cursor = [];
	host = document.createElement('div');
	document.body.appendChild(host);
	const ext = workspaceExtensions({ docs: () => ({ table: [], engine: null }) });
	ws = createWorkspace(
		{ entry: 'plan.tjp', files: { 'plan.tjp': PLAN, 'x.tji': 'task c "C" { effort 1d }\n' } },
		{ extensions: (path, top) => [ext(path, top), editorSetup(path)] },
	);
	ctl = new EditorController(ws, host, 'plan.tjp', {
		onCursor: (file, pos) => cursor.push([file, pos]),
	});
});

afterEach(() => {
	ctl.destroy();
	host.remove();
	vi.useRealTimers();
});

const lit = (): string[] =>
	[...host.querySelectorAll(`.cm-line.${SOURCE_CLASS}`)].map((l) => l.textContent ?? '');
const span = (): { from: number; to: number } | null => ctl.view.state.field(sourceHighlightField);
/** The block from `needle` to the next `end`, in the text the editor holds now. */
const block = (needle: string, end: string): SourceMark => {
	const text = ctl.view.state.doc.toString();
	const from = text.indexOf(needle);
	const to = text.indexOf(end, from) + end.length;
	return { file: 'plan.tjp', from, to, scroll: true, cursor: { from: from + 5, to: from + 6 } };
};
const focused = (view: EditorView, on: boolean): void => {
	Object.defineProperty(view, 'hasFocus', { configurable: true, get: () => on });
};

describe('the selected-source highlight', () => {
	it('puts a line class on every line of the block, and takes it off again', () => {
		ctl.mark(block('task b', '}'));
		expect(lit()).toEqual(['task b "B" {', '  effort 2d', '}']);
		ctl.mark(null);
		expect(lit()).toEqual([]);
		expect(span()).toBeNull();
	});

	it('moves with typing inside the block, and a new mark replaces the old one', () => {
		ctl.mark(block('task a', '}'));
		const before = span();
		ctl.view.dispatch({ changes: { from: 0, insert: '# top\n' } });
		expect(span()).toEqual({ from: (before?.from ?? 0) + 6, to: (before?.to ?? 0) + 6 });
		expect(lit()).toEqual(['task a "A" {', '  effort 1d', '}']);
		ctl.mark(block('task b', '}'));
		expect(lit()).toEqual(['task b "B" {', '  effort 2d', '}']);
	});

	it('highlights a block of another file in that file, so a switch shows it', () => {
		ctl.mark({ file: 'x.tji', from: 0, to: 24, scroll: false, cursor: null });
		// Not shown now, so the view has nothing lit; the workspace's state of that file has it.
		expect(lit()).toEqual([]);
		ctl.show('x.tji');
		expect(lit()).toEqual(['task c "C" { effort 1d }']);
		// A mark in the first file clears the other one: the plan shows its own, and x.tji none.
		ctl.show('plan.tjp');
		ctl.mark(block('task a', '}'));
		expect(lit()).toEqual(['task a "A" {', '  effort 1d', '}']);
		ctl.show('x.tji');
		expect(lit()).toEqual([]);
	});
});

describe('the cursor', () => {
	it('moves to the declaration of a new selection when the editor has no focus', () => {
		focused(ctl.view, false);
		const m = block('task b', '}');
		ctl.mark(m);
		expect(ctl.view.state.selection.main).toMatchObject({ from: m.cursor?.from, to: m.cursor?.to });
	});

	it('does not switch the file under a focused editor, and still marks the other file', () => {
		focused(ctl.view, true);
		ctl.mark({ file: 'x.tji', from: 0, to: 24, scroll: true, cursor: { from: 0, to: 4 } });
		expect(ctl.shown).toBe('plan.tjp');
		expect(ctl.view.state.selection.main.head).toBe(0);
		focused(ctl.view, false);
		ctl.show('x.tji');
		expect(lit()).toEqual(['task c "C" { effort 1d }']);
	});

	it('stays where it is while the editor has the focus, and when a mark only moves the highlight', () => {
		ctl.view.dispatch({ selection: { anchor: 3 } });
		focused(ctl.view, true);
		ctl.mark(block('task b', '}'));
		expect(ctl.view.state.selection.main.head).toBe(3);
		expect(lit()).toHaveLength(3);
		focused(ctl.view, false);
		ctl.mark({ ...block('task b', '}'), scroll: false });
		expect(ctl.view.state.selection.main.head).toBe(3);
	});
});

describe('the cursor callback (text to visual)', () => {
	it('hears a click at once, and never the app’s own transactions', () => {
		vi.useFakeTimers();
		ctl.mark(block('task b', '}'));
		vi.runAllTimers();
		expect(cursor).toEqual([]);
		ctl.view.dispatch({ selection: { anchor: 20 }, userEvent: 'select.pointer' });
		expect(cursor).toEqual([]);
		vi.advanceTimersByTime(0);
		expect(cursor).toEqual([['plan.tjp', 20]]);
	});

	it('hears typing once after a pause, with the cursor where it is by then', () => {
		vi.useFakeTimers();
		for (let i = 0; i < 5; i++) {
			ctl.view.dispatch({
				changes: { from: 0, insert: 'x' },
				selection: { anchor: i + 1 },
				userEvent: 'input.type',
			});
			vi.advanceTimersByTime(TYPING_QUIET_MS - 20);
		}
		expect(cursor).toEqual([]);
		vi.advanceTimersByTime(TYPING_QUIET_MS);
		expect(cursor).toEqual([['plan.tjp', 5]]);
	});

	it('is told nothing while the editor is destroyed under it', () => {
		vi.useFakeTimers();
		ctl.view.dispatch({ selection: { anchor: 4 } });
		ctl.destroy();
		vi.runAllTimers();
		expect(cursor).toEqual([]);
	});
});

describe('a held Android key', () => {
	it('keeps the highlight and the cursor back until CodeMirror has flushed it', () => {
		vi.useFakeTimers();
		const o = (ctl.view as unknown as { observer: { delayedAndroidKey: unknown } }).observer;
		o.delayedAndroidKey = { key: 'Enter', keyCode: 13, force: false };
		focused(ctl.view, false);
		ctl.mark(block('task b', '}'));
		vi.advanceTimersByTime(16 * 3);
		expect(lit()).toEqual([]);
		expect(ctl.view.state.selection.main.head).toBe(0);
		o.delayedAndroidKey = null;
		vi.advanceTimersByTime(16);
		expect(lit()).toHaveLength(3);
	});
});

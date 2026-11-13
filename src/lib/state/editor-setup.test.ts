// SPDX-License-Identifier: GPL-2.0-or-later
import { historyField } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../strings';
import { workspaceExtensions } from '../tjp/cm';
import { createWorkspace } from '../workspace/workspace';
import { editorSetup } from './editor-setup';

describe('editorSetup', () => {
	const state = EditorState.create({ doc: 'task t "T"\n', extensions: [editorSetup('plan.tjp')] });

	it('wraps lines and names the editor after its file', () => {
		const attrs = state.facet(EditorView.contentAttributes).flatMap((a) => {
			const v = typeof a === 'function' ? a(null as never) : a;
			return v ? Object.entries(v) : [];
		});
		expect(attrs).toContainEqual(['class', 'cm-lineWrapping']);
		expect(attrs).toContainEqual(['aria-label', strings.editor.label('plan.tjp')]);
	});

	it('leaves Tab unbound, so the keyboard can leave the editor', () => {
		const keys = state.facet(keymap).flat();
		expect(keys.length).toBeGreaterThan(10);
		expect(keys.filter((k) => k.key === 'Tab' || k.mac === 'Tab')).toEqual([]);
	});

	it('binds Mod-Z, Mod-Shift-Z and Mod-Y to the given history, and no CodeMirror history', () => {
		const h = { undo: vi.fn(() => true), redo: vi.fn(() => true) };
		const s = EditorState.create({ extensions: [editorSetup('plan.tjp', h)] });
		const keys = s.facet(keymap).flat();
		for (const k of ['Mod-z', 'Mod-Shift-z', 'Mod-y']) {
			expect(keys.filter((b) => b.key === k || b.mac === k)).toHaveLength(1);
		}
		expect(keys.some((b) => b.key === 'Mod-u')).toBe(false);
		keys.find((b) => b.key === 'Mod-z')?.run?.({} as never);
		keys.find((b) => b.key === 'Mod-y')?.run?.({} as never);
		expect([h.undo.mock.calls.length, h.redo.mock.calls.length]).toEqual([1, 1]);
		expect(s.field(historyField, false)).toBeUndefined();
	});

	it('builds a workspace with the editor setup and the TJP extensions together', () => {
		const ws = createWorkspace(
			{ entry: 'plan.tjp', files: { 'plan.tjp': 'project p "P" 2026-01-05 +1m\n' } },
			{
				extensions: (path, top) => [
					workspaceExtensions({ docs: () => ({ table: [], engine: null }) })(path, top),
					editorSetup(path),
				],
			},
		);
		expect(ws.state('plan.tjp').doc.toString()).toContain('project');
	});
});

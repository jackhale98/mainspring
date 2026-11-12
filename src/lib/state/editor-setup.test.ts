// SPDX-License-Identifier: GPL-2.0-or-later
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
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

	it('combines with the workspace extensions for every file', () => {
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

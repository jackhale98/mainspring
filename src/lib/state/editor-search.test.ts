// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The lazy find and replace (editor-search.ts): the same keys as @codemirror/search's own keymap,
// Escape handled only once a panel can exist, and the panel opening on the first Mod-F.
import { searchKeymap, searchPanelOpen } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, type KeyBinding } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazySearchKeymap } from './editor-search';

const sig = (k: KeyBinding): unknown => [k.key, k.scope, k.preventDefault ?? false, !!k.shift];

describe('lazySearchKeymap', () => {
	it('binds the keys of searchKeymap, with the same scopes and default handling', () => {
		expect(lazySearchKeymap.map(sig)).toEqual(searchKeymap.map(sig));
	});
});

describe('the first use', () => {
	let view: EditorView | null = null;
	afterEach(() => {
		view?.destroy();
		view = null;
	});

	it('leaves Escape alone before the package has loaded, and opens the panel on Mod-F', async () => {
		const host = document.createElement('div');
		document.body.appendChild(host);
		view = new EditorView({ state: EditorState.create({ doc: 'task t "T"\n' }), parent: host });
		const key = (name: string): KeyBinding => lazySearchKeymap.find((k) => k.key === name)!;
		expect(key('Escape').run?.(view)).toBe(false);
		expect(key('Mod-f').run?.(view)).toBe(true);
		await expect.poll(() => searchPanelOpen(view!.state)).toBe(true);
		// With the panel open, Escape closes it, as the package's own binding does.
		expect(key('Escape').run?.(view)).toBe(true);
		expect(searchPanelOpen(view.state)).toBe(false);
	});

	it('starts the fetch when Ctrl or Cmd goes down alone, so the shortcut then opens the panel at once', async () => {
		vi.resetModules();
		const fresh = await import('./editor-search');
		const host = document.createElement('div');
		document.body.appendChild(host);
		view = new EditorView({
			state: EditorState.create({ doc: 'task t "T"\n', extensions: [fresh.warmSearchOnModifier] }),
			parent: host,
		});
		view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', bubbles: true }));
		const modF = fresh.lazySearchKeymap.find((k) => k.key === 'Mod-f')!;
		// Once the warm fetch has landed, Mod-F opens the panel synchronously, not a moment later.
		await vi.waitFor(() => {
			const v = new EditorView({ state: EditorState.create({ doc: '' }), parent: host });
			try {
				modF.run?.(v);
				expect(searchPanelOpen(v.state)).toBe(true);
			} finally {
				v.destroy();
			}
		});
	});
});

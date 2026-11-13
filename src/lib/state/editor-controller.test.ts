// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The editor view against a workspace (phase-1.md 15.21): a view mounted on the workspace's state
// is brought up to date after edits made without it (`Workspace.apply`), and diagnostics, reveals
// and format work from there instead of throwing on a state the workspace has moved past.
// Phase 2 (6.8): it follows with `view.update` on the workspace's own transactions, keeping the
// view's plugins and DOM, and reveals wait for a held Android key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import { changeSetOf } from '../tjp/document';
import { workspaceExtensions } from '../tjp/cm';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import { createWorkspace, type Workspace } from '../workspace/workspace';
import { chainOf, EditorController } from './editor-controller';
import { editorSetup } from './editor-setup';

const PLAN = 'project p "P" 2026-01-05 +1m\ntask a "A" { effort 1d }\n';
const INCLUDED = 'task b "B" { effort 2d }\n';

let ws: Workspace;
let ctl: EditorController;
let host: HTMLElement;

beforeEach(() => {
	host = document.createElement('div');
	document.body.appendChild(host);
	const ext = workspaceExtensions({ docs: () => ({ table: [], engine: null }) });
	ws = createWorkspace(
		{ entry: 'plan.tjp', files: { 'plan.tjp': PLAN + 'include "b.tji"\n', 'b.tji': INCLUDED } },
		{ extensions: (path, top) => [ext(path, top), editorSetup(path)] },
	);
	ctl = new EditorController(ws, host, 'plan.tjp');
});

afterEach(() => {
	ctl.destroy();
	host.remove();
});

/** An edit through the workspace, as the edit API of Phase 2 makes them (the view is not told). */
function applyInsert(path: string, at: number, insert: string): void {
	const file = ws.snapshot().files.get(path);
	if (!file) throw new Error(path);
	const result = ws.apply({
		id: `e-${path}`,
		intent: { type: 'test' },
		base: { [path]: file.version },
		changes: { [path]: changeSetOf({ from: at, to: at, insert }, file.text.length) },
	});
	expect(result).toBe('applied');
}

const diag = (over: Partial<TjpDiagnostic> = {}): TjpDiagnostic => ({
	file: 'plan.tjp',
	from: 0,
	to: 7,
	severity: 'error',
	source: 'engine',
	messageId: 'm',
	message: 'bad',
	hint: null,
	scenario: null,
	precision: 'token',
	line: 1,
	column: 1,
	revision: 1,
	stale: false,
	...over,
});

describe('EditorController with Workspace.apply', () => {
	it('starts on the workspace state and shows the open file', () => {
		expect(ctl.view.state).toBe(ws.state('plan.tjp'));
		expect(ctl.shown).toBe('plan.tjp');
		expect(ctl.sync()).toBe(false);
	});

	it('catches up after an edit made without the view', async () => {
		applyInsert('plan.tjp', 0, '# edited\n');
		expect(ctl.view.state).not.toBe(ws.state('plan.tjp'));
		await Promise.resolve();
		expect(ctl.view.state).toBe(ws.state('plan.tjp'));
		expect(ctl.view.state.doc.toString().startsWith('# edited\n')).toBe(true);
	});

	it('syncs before pushing diagnostics, so the transaction starts from the workspace state', () => {
		applyInsert('plan.tjp', 0, '# edited\n');
		// No microtask has run: the view is behind, and a dispatch from its state would throw.
		expect(() => ctl.setEngine([diag({ from: 9, to: 16 })])).not.toThrow();
		expect(ctl.view.state).toBe(ws.state('plan.tjp'));
		expect(() => ctl.setLocal([diag({ source: 'syntax' })])).not.toThrow();
	});

	it('syncs before a reveal and selects the range in the new text', () => {
		applyInsert('plan.tjp', 0, '# edited\n');
		ctl.reveal('plan.tjp', 9, 16, false);
		const sel = ctl.view.state.selection.main;
		expect(ctl.view.state.sliceDoc(sel.from, sel.to)).toBe('project');
		expect(ctl.view.state).toBe(ws.state('plan.tjp'));
	});

	it('syncs before format', () => {
		applyInsert('plan.tjp', 0, '# edited\n');
		expect(() => ctl.format()).not.toThrow();
		expect(ctl.view.state).toBe(ws.state('plan.tjp'));
	});

	it('shows another file and keeps each file its own state', () => {
		ctl.view.dispatch({ changes: { from: 0, insert: '# one\n' } });
		ctl.show('b.tji');
		expect(ctl.shown).toBe('b.tji');
		expect(ctl.view.state.doc.toString()).toBe(INCLUDED);
		ctl.view.dispatch({ changes: { from: 0, insert: '# two\n' } });
		ctl.show('plan.tjp');
		expect(ctl.view.state.doc.toString().startsWith('# one\n')).toBe(true);
		expect(ws.snapshot().files.get('b.tji')?.text.toString().startsWith('# two\n')).toBe(true);
	});

	it('reveals without selecting when asked, keeping the selection', () => {
		ctl.view.dispatch({ selection: { anchor: 3 } });
		ctl.reveal('plan.tjp', 9, 16, false, false);
		expect(ctl.view.state.selection.main.head).toBe(3);
	});

	it('reveals in a file that is not shown, switching to it first', () => {
		ctl.reveal('b.tji', 5, 6, false);
		expect(ctl.shown).toBe('b.tji');
		const sel = ctl.view.state.selection.main;
		expect([sel.from, sel.to]).toEqual([5, 6]);
	});

	it('focuses the editor only once an open modal dialog has closed', () => {
		const dialog = document.createElement('dialog');
		document.body.appendChild(dialog);
		dialog.setAttribute('open', '');
		const focused: boolean[] = [];
		const original = ctl.view.focus.bind(ctl.view);
		ctl.view.focus = () => {
			focused.push(dialog.hasAttribute('open'));
			original();
		};
		ctl.reveal('plan.tjp', 0, 1, true);
		expect(focused).toEqual([]);
		dialog.removeAttribute('open');
		dialog.dispatchEvent(new Event('close'));
		expect(focused).toEqual([false]);
		dialog.remove();
		ctl.reveal('plan.tjp', 0, 1, true);
		expect(focused).toEqual([false, false]);
	});

	it('does not focus when asked not to (a touch keyboard would cover the editor)', () => {
		let calls = 0;
		ctl.view.focus = () => void calls++;
		ctl.reveal('plan.tjp', 0, 1, false);
		expect(calls).toBe(0);
	});
});

describe('following the workspace with view.update (phase-2.md 6.8)', () => {
	const hold = (view: EditorView, on: boolean): void => {
		const o = (view as unknown as { observer: { delayedAndroidKey: unknown } }).observer;
		o.delayedAndroidKey = on ? { key: 'Enter', keyCode: 13, force: false } : null;
	};

	it('updates the view with the applied transactions, keeping its DOM and plugin state', async () => {
		let instances = 0;
		const updates: number[] = [];
		const probe = ViewPlugin.define(() => {
			instances++;
			return { update: (u) => void updates.push(u.transactions.length) };
		});
		ctl.destroy();
		const ext = workspaceExtensions({ docs: () => ({ table: [], engine: null }) });
		ws = createWorkspace(
			{ entry: 'plan.tjp', files: { 'plan.tjp': PLAN + 'include "b.tji"\n', 'b.tji': INCLUDED } },
			{ extensions: (path, top) => [ext(path, top), editorSetup(path), probe] },
		);
		ctl = new EditorController(ws, host, 'plan.tjp');
		const content = ctl.view.contentDOM;
		const setState = vi.spyOn(ctl.view, 'setState');
		applyInsert('plan.tjp', 0, '# one\n');
		applyInsert('plan.tjp', 0, '# two\n');
		await Promise.resolve();
		expect(ctl.view.state).toBe(ws.state('plan.tjp'));
		expect(setState).not.toHaveBeenCalled();
		// One update with both transactions; the plugin and the DOM are the same ones.
		expect(updates).toContain(2);
		expect(instances).toBe(1);
		expect(ctl.view.contentDOM).toBe(content);
		expect(ctl.view.state.doc.toString().startsWith('# two\n# one\n')).toBe(true);
	});

	it('falls back to setState when the transactions do not chain (a reconfiguration)', async () => {
		const setState = vi.spyOn(ctl.view, 'setState');
		const ext = workspaceExtensions({ docs: () => ({ table: [], engine: null }) });
		ws.attachEditor({ extensions: (path, top) => [ext(path, top), editorSetup(path)] });
		ctl.sync();
		expect(setState).toHaveBeenCalledTimes(1);
		expect(ctl.view.state).toBe(ws.state('plan.tjp'));
	});

	it('ignores transactions of other files and of a file it no longer shows', async () => {
		const setState = vi.spyOn(ctl.view, 'setState');
		applyInsert('b.tji', 0, '# b\n');
		await Promise.resolve();
		expect(setState).not.toHaveBeenCalled();
		expect(ctl.view.state).toBe(ws.state('plan.tjp'));
	});

	it('chains only consecutive transactions that end at the target', () => {
		const s0 = ws.state('plan.tjp');
		const t1 = s0.update({ changes: { from: 0, insert: 'a' } });
		const t2 = t1.state.update({ changes: { from: 0, insert: 'b' } });
		const other = s0.update({ changes: { from: 0, insert: 'z' } });
		expect(chainOf(s0, [t1, t2], t2.state)).toEqual([t1, t2]);
		expect(chainOf(t1.state, [t1, t2], t2.state)).toEqual([t2]);
		expect(chainOf(s0, [other, t1, t2], t2.state)).toBeNull();
		expect(chainOf(s0, [t1], t2.state)).toBeNull();
		expect(chainOf(t2.state, [t1, t2], t2.state)).toBeNull();
	});

	it('says whether an Android key is held in a shown file', () => {
		expect(ctl.keyHeld(['plan.tjp'])).toBe(false);
		hold(ctl.view, true);
		expect(ctl.keyHeld(['plan.tjp'])).toBe(true);
		expect(ctl.keyHeld(['b.tji'])).toBe(false);
		hold(ctl.view, false);
	});

	it('waits for a held Android key before it reveals', () => {
		vi.useFakeTimers();
		try {
			hold(ctl.view, true);
			ctl.reveal('plan.tjp', 0, 7, false);
			expect(ctl.view.state.selection.main.to).toBe(0);
			vi.advanceTimersByTime(16 * 3);
			expect(ctl.view.state.selection.main.to).toBe(0);
			hold(ctl.view, false);
			vi.advanceTimersByTime(16);
			expect(ctl.view.state.sliceDoc(0, ctl.view.state.selection.main.to)).toBe('project');
		} finally {
			vi.useRealTimers();
		}
	});
});

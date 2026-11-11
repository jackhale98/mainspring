// SPDX-License-Identifier: GPL-2.0-or-later
import { undo } from '@codemirror/commands';
import { EditorState, Transaction, type ChangeSet } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { serialize } from '../../../tests/grammar/corpus';
import { changeSetOf, parseTjp, syntaxIssues } from '../tjp/document';
import {
	createWorkspace,
	decodeWorkspaceFile,
	scheduleRequestOf,
	tjpEditId,
	type Workspace,
	type WorkspaceEdit,
} from './workspace';

const PLAN =
	'project p "P" 2026-01-05 +1m {\n  now 2026-01-05\n}\ninclude "x.tji"\ntask a "A" {\n  effort 2d\n}\n';
const X = 'task x "X" {\n  effort 1d\n}\n';
const seed = () =>
	createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN, 'lib/x.tji': X, 'x.tji': X } });

/** An edit replacing `find` in a file of the workspace. */
function edit(ws: Workspace, path: string, find: string, insert: string, id = 'e1'): WorkspaceEdit {
	const file = ws.snapshot().files.get(path);
	if (!file) throw new Error(path);
	const from = file.text.toString().indexOf(find);
	return {
		id,
		intent: { type: 'setAttr' },
		base: { [path]: file.version },
		changes: { [path]: changeSetOf({ from, to: from + find.length, insert }, file.text.length) },
	};
}

function typeAt(ws: Workspace, path: string, pos: number, insert: string): Transaction {
	return ws.state(path).update({ changes: { from: pos, insert }, userEvent: 'input.type' });
}

describe('createWorkspace', () => {
	it('parses every file in its context and walks the includes', () => {
		const ws = seed();
		const s = ws.snapshot();
		expect(s.entry).toBe('plan.tjp');
		expect(s.version).toBe(0);
		expect(s.includes.order).toEqual(['plan.tjp', 'x.tji']);
		expect([...s.files.keys()].sort()).toEqual(['lib/x.tji', 'plan.tjp', 'x.tji']);
		for (const f of s.files.values()) {
			expect(f.version).toBe(0);
			expect(f.top).toBe('global');
			expect(syntaxIssues(f.tree, f.text)).toEqual([]);
		}
		expect(ws.snapshot()).toBe(s);
	});

	it('rejects invalid paths and a missing entry', () => {
		expect(() => createWorkspace({ entry: 'a.tjp', files: { 'b.tjp': '' } })).toThrow(/entry/);
		expect(() =>
			createWorkspace({ entry: 'a.tjp', files: { 'a.tjp': '', '../b.tji': '' } }),
		).toThrow(/invalid workspace path/);
		expect(() => seed().state('nope.tjp')).toThrow(/unknown workspace file/);
	});

	it('keeps \\r and the BOM as text', () => {
		const text = '﻿project p "P" 2026-01-05 +1m\r\ntask a "A"\r\n';
		const ws = createWorkspace({ entry: 'p.tjp', files: { 'p.tjp': text } });
		expect(ws.texts()).toEqual({ 'p.tjp': text });
		expect(ws.state('p.tjp').doc.lines).toBe(3);
		expect(ws.state('p.tjp').lineBreak).toBe('\n');
		expect(scheduleRequestOf(ws, 7)).toEqual({
			files: { 'p.tjp': text },
			entry: 'p.tjp',
			revision: 7,
		});
	});
});

describe('commit', () => {
	it('reparses the file, bumps versions and notifies', () => {
		const ws = seed();
		const listener = vi.fn();
		const off = ws.subscribe(listener);
		const tr = typeAt(ws, 'x.tji', X.indexOf('1d'), '1');
		ws.commit('x.tji', tr, 'typing');
		const s = ws.snapshot();
		expect(s.version).toBe(1);
		const f = s.files.get('x.tji');
		expect(f?.version).toBe(1);
		expect(f?.text.toString()).toContain('effort 11d');
		expect(serialize(f?.tree ?? parseTjp(''))).toEqual(
			serialize(parseTjp(f?.text.toString() ?? '')),
		);
		expect(ws.state('x.tji')).toBe(tr.state);
		expect(listener).toHaveBeenCalledOnce();
		expect(listener.mock.calls[0]?.[1]).toBe('typing');
		expect(listener.mock.calls[0]?.[2]).toEqual({ paths: ['x.tji'], transactions: [tr] });
		off();
		ws.commit('x.tji', typeAt(ws, 'x.tji', 0, '#'), 'format');
		expect(listener).toHaveBeenCalledOnce();
	});

	it('takes several transactions, and selection-only ones without a version bump', () => {
		const ws = seed();
		const t1 = ws.state('plan.tjp').update({ selection: { anchor: 3 } });
		ws.commit('plan.tjp', t1, 'typing');
		expect(ws.snapshot().version).toBe(0);
		expect(ws.state('plan.tjp').selection.main.head).toBe(3);
		const t2 = t1.state.update({ changes: { from: 0, insert: '# a\n' } });
		const t3 = t2.state.update({ changes: { from: 0, insert: '# b\n' } });
		ws.commit('plan.tjp', [t2, t3], 'typing');
		expect(ws.snapshot().version).toBe(1);
		expect(ws.snapshot().files.get('plan.tjp')?.version).toBe(2);
		expect(ws.texts()['plan.tjp']).toBe(`# b\n# a\n${PLAN}`);
	});

	it('refuses transactions that do not start from the workspace state', () => {
		const ws = seed();
		const stray = EditorState.create({ doc: PLAN }).update({ changes: { from: 0, insert: 'x' } });
		expect(() => ws.commit('plan.tjp', stray, 'typing')).toThrow(/does not start/);
	});

	it('keeps per-file history', () => {
		const ws = seed();
		ws.commit('x.tji', typeAt(ws, 'x.tji', 0, '# note\n'), 'typing');
		let undone: Transaction | null = null;
		undo({
			state: ws.state('x.tji'),
			dispatch: (tr) => {
				undone = tr;
			},
		});
		if (!undone) throw new Error('nothing to undo');
		ws.commit('x.tji', undone, 'typing');
		expect(ws.texts()['x.tji']).toBe(X);
	});
});

describe('apply', () => {
	it('applies one transaction per file with the edit id and user event', () => {
		const ws = seed();
		const listener = vi.fn();
		ws.subscribe(listener);
		const a = edit(ws, 'plan.tjp', '2d', '3d');
		const b = edit(ws, 'x.tji', '1d', '4d');
		const both: WorkspaceEdit = {
			...a,
			base: { ...a.base, ...b.base },
			changes: { ...a.changes, ...b.changes },
		};
		expect(ws.apply(both)).toBe('applied');
		expect(ws.texts()['plan.tjp']).toContain('effort 3d');
		expect(ws.texts()['x.tji']).toContain('effort 4d');
		expect(ws.snapshot().version).toBe(1);
		const info = listener.mock.calls[0]?.[2] as { transactions: Transaction[] };
		expect(listener.mock.calls[0]?.[1]).toBe('intent');
		for (const tr of info.transactions) {
			expect(tr.annotation(tjpEditId)).toBe('e1');
			expect(tr.isUserEvent('input.tjp.setAttr')).toBe(true);
		}
	});

	it('is stale when a base version moved, and changes nothing', () => {
		const ws = seed();
		const e = edit(ws, 'x.tji', '1d', '4d');
		ws.commit('x.tji', typeAt(ws, 'x.tji', 0, ' '), 'typing');
		const before = ws.texts();
		expect(ws.apply(e)).toBe('stale');
		expect(ws.texts()).toEqual(before);
	});

	it('throws on unknown files and change sets of the wrong length', () => {
		const ws = seed();
		const e = edit(ws, 'x.tji', '1d', '4d');
		expect(() =>
			ws.apply({ ...e, changes: { 'no.tji': changeSetOf([], 0) }, base: { 'no.tji': 0 } }),
		).toThrow(/unknown workspace file/);
		expect(() => ws.apply({ ...e, changes: { 'x.tji': changeSetOf([], 1) } })).toThrow(RangeError);
		expect(ws.apply({ ...e, changes: { 'x.tji': changeSetOf([], X.length) } })).toBe('applied');
		expect(ws.snapshot().version).toBe(0);
	});
});

describe('include contexts follow edits', () => {
	it('reparses an included file when its context changes', () => {
		const ws = seed();
		const plan = ws.texts()['plan.tjp'] ?? '';
		// Move the include into the project header: x.tji is now read as 'project'.
		const from = plan.indexOf('include');
		const line = 'include "x.tji"\n';
		const cs = changeSetOf(
			[
				{ from, to: from + line.length },
				{ from: plan.indexOf('}'), insert: '  include "x.tji"\n' },
			],
			plan.length,
		);
		const base = ws.snapshot().files.get('x.tji')?.version ?? -1;
		ws.apply({
			id: 'm',
			intent: { type: 'moveTask' },
			base: { 'plan.tjp': 0 },
			changes: { 'plan.tjp': cs },
		});
		const x = ws.snapshot().files.get('x.tji');
		expect(x?.top).toBe('project');
		expect(x?.version).toBe(base + 1);
		expect(ws.snapshot().includes.edges[0]?.top).toBe('project');
		expect(
			syntaxIssues(x?.tree ?? parseTjp(''), x?.text ?? ws.state('x.tji').doc).length,
		).toBeGreaterThan(0);
	});
});

describe('changesSince', () => {
	it('composes the changes of each file after a version', () => {
		const ws = seed();
		ws.commit('x.tji', typeAt(ws, 'x.tji', 0, 'a'), 'typing');
		ws.commit('x.tji', typeAt(ws, 'x.tji', 1, 'b'), 'typing');
		ws.commit('plan.tjp', typeAt(ws, 'plan.tjp', 0, 'c'), 'typing');
		const all = ws.changesSince(0);
		expect([...all.keys()].sort()).toEqual(['plan.tjp', 'x.tji']);
		expect(all.get('x.tji')?.apply(parseText(X)).toString()).toBe(`ab${X}`);
		expect([...ws.changesSince(2).keys()]).toEqual(['plan.tjp']);
		expect(ws.changesSince(3).size).toBe(0);
		const cs = all.get('x.tji') as ChangeSet;
		expect(cs.mapPos(0, 1)).toBe(2);
	});

	it('forgets old entries past the log limit', () => {
		const ws = createWorkspace({ entry: 'p.tjp', files: { 'p.tjp': '' } }, { logLimit: 4 });
		for (let i = 0; i < 6; i++) ws.commit('p.tjp', typeAt(ws, 'p.tjp', 0, 'x'), 'typing');
		expect(() => ws.changesSince(0)).toThrow(RangeError);
		expect(ws.changesSince(4).get('p.tjp')?.apply(parseText('xxxx')).toString()).toBe('xxxxxx');
	});
});

describe('decodeWorkspaceFile (ADR-0002 #13)', () => {
	it('keeps the BOM and replaces invalid bytes', () => {
		expect(decodeWorkspaceFile(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('﻿a');
		expect(decodeWorkspaceFile(new Uint8Array([0x61, 0xff, 0x62]))).toBe('a�b');
	});
});

function parseText(s: string) {
	return EditorState.create({ doc: s, extensions: EditorState.lineSeparator.of('\n') }).doc;
}

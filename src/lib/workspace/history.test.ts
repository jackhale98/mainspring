// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for the workspace history (phase-2.md 6.7, 13.1; ADR-0008). Grouping rules are in
// history-steps.test.ts; random sequences in history.property.test.ts.
import { EditorSelection, Text, Transaction } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { changeSetOf } from '../tjp/document';
import { undoEdit } from '../tjp/edit/apply';
import { createHistory, historyLabel, tjpHistory } from './history';
import {
	A,
	B,
	FILES,
	format,
	intent,
	moveCursor,
	PLAN,
	seedWorkspace,
	textOf,
	type,
} from './testing/history-fixture';
import type { ChangeOrigin, WorkspaceEdit } from './workspace';

const at = (text: string, needle: string): number => {
	const i = text.indexOf(needle);
	if (i < 0) throw new Error(`no ${needle}`);
	return i;
};

describe('createHistory', () => {
	it('starts empty', () => {
		const h = createHistory(seedWorkspace());
		expect([h.canUndo, h.canRedo, h.top(), h.redoTop()]).toEqual([false, false, null, null]);
		expect(h.undo()).toEqual({ status: 'empty' });
		expect(h.redo()).toEqual({ status: 'empty' });
	});

	it('groups a burst of typing into one step and undoes it byte for byte', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		// Between "1" and "d": "12d", "123d", then Backspace: "12d".
		const p = at(A, '1d') + 1;
		type(ws, 'a.tji', p, '2', { time: 1000 });
		type(ws, 'a.tji', p + 1, '3', { time: 1100 });
		type(ws, 'a.tji', p + 1, '', { time: 1200, to: p + 2 });
		expect(h.top()).toMatchObject({ kind: 'typing', label: 'typing' });
		const r = h.undo();
		expect(r).toMatchObject({ status: 'done', direction: 'undo' });
		expect(textOf(ws, 'a.tji')).toBe(A);
		expect(h.canUndo).toBe(false);
		h.redo();
		expect(textOf(ws, 'a.tji')).toBe(A.replace('1d', '12d'));
	});

	it('makes each intent and format one step, apart from the typing around it', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		const p = at(PLAN, '2d') + 1;
		type(ws, 'plan.tjp', p, '0', { time: 10 });
		const e = intent(ws, { type: 'setAttr', task: 'a.a1', attr: 'effort', value: '5d' });
		expect(e).not.toBeNull();
		expect(h.top()).toMatchObject({ id: e?.id, kind: 'intent', label: 'set effort' });
		expect(format(ws, 'b.tji')).toBe(true);
		expect(h.top()).toMatchObject({ kind: 'format', label: 'format' });
		const after = ws.texts();
		// Typing right after the format, within the group delay, is its own step.
		type(ws, 'plan.tjp', p + 1, '0', { time: 20 });
		h.undo();
		expect(ws.texts()).toEqual(after);
		h.undo();
		expect(textOf(ws, 'b.tji')).toBe(B);
		h.undo();
		expect(textOf(ws, 'a.tji')).toBe(A);
		expect(textOf(ws, 'plan.tjp')).toBe(PLAN.replace('2d', '20d'));
		h.undo();
		expect(ws.texts()).toEqual(FILES);
		expect(h.canUndo).toBe(false);
		for (let i = 0; i < 4; i++) expect(h.redo().status).toBe('done');
		expect(ws.texts()).toEqual({ ...after, 'plan.tjp': PLAN.replace('2d', '200d') });
	});

	it('records a format the editor commits, under its edit id', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		const ids: Array<string | undefined> = [];
		ws.subscribe((_s, _o, info) => ids.push(info.transactions[0]?.annotation(tjpHistory)));
		expect(format(ws, 'b.tji', 'editor')).toBe(true);
		expect(h.top()).toMatchObject({ kind: 'format' });
		h.undo();
		expect(textOf(ws, 'b.tji')).toBe(B);
		expect(ids).toEqual([undefined, 'undo']);
	});

	it('undoes across files in order, with origin history, and reveals the changed range', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		const origins: ChangeOrigin[] = [];
		ws.subscribe((_s, o) => origins.push(o));
		type(ws, 'a.tji', 0, '# a\n', { time: 1 });
		type(ws, 'b.tji', 0, '# b\n', { time: 2 });
		const r = h.undo();
		expect(r).toMatchObject({ status: 'done', reveal: { file: 'b.tji', from: 0, to: 0 } });
		expect(textOf(ws, 'b.tji')).toBe(B);
		expect(textOf(ws, 'a.tji')).toBe(`# a\n${A}`);
		h.undo();
		expect(ws.texts()).toEqual(FILES);
		const re = h.redo();
		expect(re).toMatchObject({ status: 'done', reveal: { file: 'a.tji', from: 0, to: 4 } });
		expect(origins).toEqual(['typing', 'typing', 'history', 'history', 'history']);
	});

	it('reveals an intent at its select range on redo', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		const e = intent(ws, { type: 'setAttr', task: 'b', attr: 'effort', value: '9d' });
		h.undo();
		const r = h.redo();
		expect(r.status === 'done' && r.reveal).toEqual(e?.select);
	});

	it('restores the selection from before an undo and after a redo', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		moveCursor(ws, 'a.tji', 5);
		type(ws, 'a.tji', 0, 'xy', { time: 1 });
		moveCursor(ws, 'a.tji', 1);
		h.undo();
		expect(ws.state('a.tji').selection.main.head).toBe(5);
		h.redo();
		expect(ws.state('a.tji').selection.main.head).toBe(2);
	});

	it('takes an edit with two files as one step, labelled by the dispatcher', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		const snap = ws.snapshot();
		const fa = snap.files.get('a.tji');
		const fb = snap.files.get('b.tji');
		if (!fa || !fb) throw new Error('files');
		const edit: WorkspaceEdit = {
			id: 'two',
			intent: { type: 'moveTask' },
			base: { 'a.tji': fa.version, 'b.tji': fb.version },
			changes: {
				'a.tji': changeSetOf({ from: 0, insert: '# 1\n' }, A.length),
				'b.tji': changeSetOf({ from: 0, to: 4, insert: 'task' }, B.length),
			},
		};
		ws.apply(edit, { annotations: [historyLabel.of('Move B under A')] });
		expect(h.top()).toMatchObject({ id: 'two', kind: 'intent', label: 'Move B under A' });
		h.undo();
		expect(ws.texts()).toEqual(FILES);
		h.redo();
		expect(textOf(ws, 'a.tji')).toBe(`# 1\n${A}`);
	});

	it('clears redo once something new is recorded', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		type(ws, 'a.tji', 0, 'x', { time: 1 });
		h.undo();
		expect(h.canRedo).toBe(true);
		type(ws, 'b.tji', 0, 'y', { time: 2 });
		expect(h.canRedo).toBe(false);
		expect(h.redo()).toEqual({ status: 'empty' });
	});

	it('keeps at most `limit` steps', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws, { limit: 2 });
		for (let i = 0; i < 4; i++) type(ws, 'a.tji', 0, `${i}`, { time: i * 1000 });
		expect(h.undo().status).toBe('done');
		expect(h.undo().status).toBe('done');
		expect(h.undo().status).toBe('empty');
		expect(textOf(ws, 'a.tji')).toBe(`10${A}`);
	});
});

describe('version re-stamping', () => {
	it('keeps undoEdit valid for the uncovered entry, whose text is exactly as after it', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		intent(ws, { type: 'setAttr', task: 'a.a1', attr: 'effort', value: '5d' });
		const afterFirst = ws.snapshot().files.get('a.tji')?.text ?? Text.empty;
		type(ws, 'a.tji', 0, '# x\n', { time: 1 });
		h.undo();
		const top = h.top();
		if (!top) throw new Error('top');
		const now = ws.snapshot();
		expect(now.files.get('a.tji')?.text.eq(afterFirst)).toBe(true);
		expect(top.applied.versions['a.tji']).toBe(now.files.get('a.tji')?.version);
		expect(undoEdit(top.applied, now)).not.toBeNull();
		// Redo then undo again: the redone entry is re-stamped the same way.
		h.redo();
		h.undo();
		h.undo();
		expect(ws.texts()).toEqual(FILES);
		h.redo();
		h.redo();
		expect(textOf(ws, 'a.tji')).toBe(`# x\n${A.replace('1d', '5d')}`);
	});

	it('follows a version bump without a text change (a parse-context change)', () => {
		const files = { 'plan.tjp': PLAN, 'a.tji': A, 'b.tji': B };
		const ws = seedWorkspace(files);
		const h = createHistory(ws);
		type(ws, 'a.tji', 0, '# x\n', { time: 1 });
		const va = ws.snapshot().files.get('a.tji')?.version ?? -1;
		// Move the include of a.tji into the project block: a.tji is now read as 'project'.
		const plan = textOf(ws, 'plan.tjp');
		const line = 'include "a.tji"\n';
		const from = at(plan, line);
		const v = ws.snapshot().files.get('plan.tjp')?.version ?? -1;
		ws.apply({
			id: 'mv',
			intent: { type: 'moveTask' },
			base: { 'plan.tjp': v },
			changes: {
				'plan.tjp': changeSetOf(
					[
						{ from: at(plan, '}'), insert: `  ${line}` },
						{ from, to: from + line.length },
					],
					plan.length,
				),
			},
		});
		expect(ws.snapshot().files.get('a.tji')?.version).toBeGreaterThan(va);
		h.undo();
		expect(h.undo().status).toBe('done');
		expect(ws.texts()).toEqual(files);
	});

	it('keeps steps from one commit apart when they do not group', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		const s0 = ws.state('a.tji');
		const t1 = s0.update({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
		const t2 = t1.state.update({ changes: { from: 1, insert: 'P' }, userEvent: 'input.paste' });
		ws.commit('a.tji', [t1, t2], 'typing');
		h.undo();
		expect(textOf(ws, 'a.tji')).toBe(`x${A}`);
		h.undo();
		expect(textOf(ws, 'a.tji')).toBe(A);
		h.redo();
		h.redo();
		expect(textOf(ws, 'a.tji')).toBe(`xP${A}`);
	});
});

describe('changes that bypass the history', () => {
	const bypass = { annotations: [Transaction.addToHistory.of(false)] };

	it('give diverged on undo, clear both stacks and apply nothing', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		const heard = vi.fn();
		type(ws, 'a.tji', 0, 'x', { time: 1 });
		type(ws, 'b.tji', 0, 'y', { time: 2 });
		h.undo();
		h.subscribe(heard);
		// Same length: only the version check can tell.
		type(ws, 'a.tji', 0, 'z', { to: 1, spec: bypass });
		const before = ws.texts();
		const r = h.undo();
		expect(r).toMatchObject({ status: 'diverged', direction: 'undo', entry: { kind: 'typing' } });
		expect(ws.texts()).toEqual(before);
		expect([h.canUndo, h.canRedo]).toEqual([false, false]);
		expect(heard).toHaveBeenCalledOnce();
	});

	it('give diverged on redo', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		intent(ws, { type: 'setAttr', task: 'a.a1', attr: 'effort', value: '5d' });
		h.undo();
		type(ws, 'a.tji', 0, '#', { spec: bypass });
		const before = ws.texts();
		expect(h.redo()).toMatchObject({ status: 'diverged', direction: 'redo' });
		expect(ws.texts()).toEqual(before);
		expect(h.canRedo).toBe(false);
	});

	it('do not block undo of a step in another file', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		type(ws, 'a.tji', 0, 'x', { time: 1 });
		type(ws, 'b.tji', 0, '#', { spec: bypass });
		expect(h.undo().status).toBe('done');
		expect(textOf(ws, 'a.tji')).toBe(A);
	});

	it('are not joined by later typing', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		type(ws, 'a.tji', 0, 'x', { time: 1 });
		type(ws, 'a.tji', 1, 'y', { time: 2, spec: bypass });
		type(ws, 'a.tji', 2, 'z', { time: 3 });
		expect(h.undo().status).toBe('done');
		expect(textOf(ws, 'a.tji')).toBe(`xy${A}`);
		expect(h.undo().status).toBe('diverged');
		expect(textOf(ws, 'a.tji')).toBe(`xy${A}`);
	});
});

describe('subscribe and dispose', () => {
	it('notifies when the top changes, not for every keystroke of a group', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		const heard = vi.fn();
		const off = h.subscribe(heard);
		type(ws, 'a.tji', 0, 'a', { time: 1 });
		type(ws, 'a.tji', 1, 'b', { time: 2 });
		type(ws, 'a.tji', 2, 'c', { time: 3 });
		expect(heard).toHaveBeenCalledTimes(1);
		h.undo();
		expect(heard).toHaveBeenCalledTimes(2);
		off();
		h.redo();
		expect(heard).toHaveBeenCalledTimes(2);
	});

	it('stops recording once disposed', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		h.dispose();
		type(ws, 'a.tji', 0, 'a', { time: 1 });
		expect(h.canUndo).toBe(false);
	});

	it('gives the selections of every file of an entry', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		type(ws, 'b.tji', 0, 'q', { time: 1 });
		const top = h.top();
		expect(top?.selectionBefore['b.tji']?.main.head).toBe(0);
		expect(top?.selectionAfter['b.tji']?.eq(EditorSelection.single(1))).toBe(true);
	});
});

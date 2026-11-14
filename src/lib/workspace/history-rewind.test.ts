// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for the list of undo steps and `rewind` (the phone's History sheet; ADR-0008): labels
// and times of entries, N steps in one go, a refusal midway, and redo stepping forward again.
import { Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { applyEdit } from '../tjp/edit/apply';
import { createHistory, historyLabel } from './history';
import {
	A,
	B,
	FILES,
	PLAN,
	intent,
	plan,
	seedWorkspace,
	textOf,
	type,
} from './testing/history-fixture';

const bypass = { annotations: [Transaction.addToHistory.of(false)] };

/** Three entries in three files: typing in plan.tjp, an intent in a.tji, typing in b.tji. */
function three() {
	const ws = seedWorkspace();
	const h = createHistory(ws);
	type(ws, 'plan.tjp', PLAN.length, '# x\n', { time: 1_000 });
	intent(ws, { type: 'setAttr', task: 'a.a1', attr: 'effort', value: '5d' });
	type(ws, 'b.tji', 0, '#', { time: 9_000 });
	return { ws, h };
}

describe('undoItems', () => {
	it('lists the undo stack newest first, with kind, label, files and time', () => {
		const { h } = three();
		const items = h.undoItems();
		expect(items.map((i) => i.kind)).toEqual(['typing', 'intent', 'typing']);
		expect(items.map((i) => i.files)).toEqual([['b.tji'], ['a.tji'], ['plan.tjp']]);
		expect(items[0]?.label).toBe('typing');
		expect(items[1]?.label).toBe('set effort');
		expect(items[0]?.time).toBe(9_000);
		expect(items[2]?.time).toBe(1_000);
		expect(new Set(items.map((i) => i.id)).size).toBe(3);
	});

	it('uses the label the dispatcher gave the entry, and stamps it with the time of the edit', () => {
		const ws = seedWorkspace();
		const h = createHistory(ws);
		const edit = plan(ws, { type: 'setAttr', task: 'a.a1', attr: 'effort', value: '4d' });
		expect(edit).not.toBeNull();
		if (!edit) return;
		const t0 = Date.now();
		applyEdit(ws, edit, { annotations: [historyLabel.of('Effort of A1: 1d to 4d')] });
		const [item] = h.undoItems();
		expect(item).toMatchObject({ kind: 'intent', label: 'Effort of A1: 1d to 4d' });
		expect(item?.time).toBeGreaterThanOrEqual(t0);
		expect(item?.time).toBeLessThanOrEqual(Date.now());
		expect(h.top()?.time).toBe(item?.time);
	});

	it('follows undo and redo', () => {
		const { h } = three();
		h.undo();
		expect(h.undoItems()).toHaveLength(2);
		h.redo();
		expect(h.undoItems()).toHaveLength(3);
		expect(h.undoItems()[0]?.files).toEqual(['b.tji']);
	});

	it('is empty without history', () => {
		expect(createHistory(seedWorkspace()).undoItems()).toEqual([]);
	});
});

describe('rewind', () => {
	it('undoes N entries newest first and leaves the rest', () => {
		const { ws, h } = three();
		const r = h.rewind(2);
		expect(r).toMatchObject({ requested: 2, undone: 2, stopped: null });
		expect(r.done.map((o) => o.entry.kind)).toEqual(['typing', 'intent']);
		expect(textOf(ws, 'b.tji')).toBe(B);
		expect(textOf(ws, 'plan.tjp')).toBe(`${PLAN}# x\n`);
		expect(h.undoItems()).toHaveLength(1);
		expect(h.canRedo).toBe(true);
	});

	it('back to the start gives the original text byte for byte', () => {
		const { ws, h } = three();
		expect(h.rewind(3)).toMatchObject({ undone: 3, stopped: null });
		expect(ws.texts()).toEqual(FILES);
		expect(h.canUndo).toBe(false);
	});

	it('redo steps forward one entry at a time after a rewind', () => {
		const { ws, h } = three();
		const after = ws.texts();
		h.rewind(3);
		h.redo();
		expect(textOf(ws, 'plan.tjp')).toBe(`${PLAN}# x\n`);
		h.redo();
		expect(textOf(ws, 'a.tji')).not.toBe(A);
		expect(textOf(ws, 'b.tji')).toBe(B);
		h.redo();
		expect(ws.texts()).toEqual(after);
		expect(h.canRedo).toBe(false);
	});

	it('stops where an undo is refused: the newer entries are undone, nothing older is touched', () => {
		const { ws, h } = three();
		// A file of the intent changes outside the history, after the newest entry was made.
		type(ws, 'a.tji', 0, 'Z', { to: 1, spec: bypass });
		const afterBypass = textOf(ws, 'a.tji');
		const r = h.rewind(3);
		expect(r).toMatchObject({ requested: 3, undone: 1, stopped: 'diverged' });
		expect(textOf(ws, 'b.tji')).toBe(B);
		expect(textOf(ws, 'a.tji')).toBe(afterBypass);
		expect([h.canUndo, h.canRedo]).toEqual([false, false]);
	});

	it('reports empty when asked for more than there is', () => {
		const { ws, h } = three();
		const r = h.rewind(5);
		expect(r).toMatchObject({ requested: 5, undone: 3, stopped: 'empty' });
		expect(ws.texts()).toEqual(FILES);
	});

	it('does nothing for zero steps', () => {
		const { ws, h } = three();
		const before = ws.texts();
		expect(h.rewind(0)).toMatchObject({ undone: 0, stopped: null });
		expect(ws.texts()).toEqual(before);
	});
});

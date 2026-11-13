// SPDX-License-Identifier: GPL-2.0-or-later
// Typing groups as CodeMirror forms them (history-steps.ts), checked through the history, and
// the labels of intents.
import { Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { historyStrings } from '../strings';
import { createHistory, type WorkspaceHistory } from './history';
import { isTjpEdit, isolateHistory, labelOf } from './history-steps';
import { A, moveCursor, plan, seedWorkspace, textOf, type } from './testing/history-fixture';
import type { Workspace } from './workspace';

/**
 * How many undo steps the history holds (undoes them all, then redoes them). Call it last: after
 * an undo or redo, typing never joins the uncovered step.
 */
function depth(h: WorkspaceHistory): number {
	let n = 0;
	while (h.undo().status === 'done') n++;
	for (let i = 0; i < n; i++) h.redo();
	return n;
}

function setup(groupMs?: number): { ws: Workspace; h: WorkspaceHistory } {
	const ws = seedWorkspace();
	return { ws, h: createHistory(ws, groupMs === undefined ? {} : { groupMs }) };
}

describe('typing groups', () => {
	it('join adjacent typing in one file within the delay', () => {
		const { ws, h } = setup();
		type(ws, 'a.tji', 0, 'a', { time: 0 });
		type(ws, 'a.tji', 1, 'b', { time: 499 });
		type(ws, 'a.tji', 2, 'c', { time: 998 });
		expect(depth(h)).toBe(1);
		expect(textOf(ws, 'a.tji')).toBe(`abc${A}`);
	});

	it('start a new group at the delay, or at a custom delay', () => {
		const a = setup();
		type(a.ws, 'a.tji', 0, 'a', { time: 0 });
		type(a.ws, 'a.tji', 1, 'b', { time: 500 });
		expect(depth(a.h)).toBe(2);
		const b = setup(50);
		type(b.ws, 'a.tji', 0, 'a', { time: 0 });
		type(b.ws, 'a.tji', 1, 'b', { time: 60 });
		expect(depth(b.h)).toBe(2);
	});

	it('do not join typing elsewhere in the file, or after the cursor moved', () => {
		const { ws, h } = setup();
		type(ws, 'a.tji', 0, 'a', { time: 0 });
		type(ws, 'a.tji', 10, 'b', { time: 1 });
		expect(depth(h)).toBe(2);
		moveCursor(ws, 'a.tji', 0);
		moveCursor(ws, 'a.tji', 11);
		type(ws, 'a.tji', 11, 'c', { time: 2 });
		expect(depth(h)).toBe(3);
	});

	it('do not join typing in another file', () => {
		const { ws, h } = setup();
		type(ws, 'a.tji', 0, 'a', { time: 0 });
		type(ws, 'b.tji', 0, 'b', { time: 1 });
		type(ws, 'a.tji', 1, 'c', { time: 2 });
		expect(depth(h)).toBe(3);
	});

	it('join deletes and typed text, as CodeMirror does (Backspace twice, then "40d")', () => {
		const { ws, h } = setup();
		const p = textOf(ws, 'a.tji').indexOf('1d') + 2;
		type(ws, 'a.tji', p - 1, '', { time: 0, to: p });
		type(ws, 'a.tji', p - 2, '', { time: 50, to: p - 1 });
		type(ws, 'a.tji', p - 2, '40d', { time: 100 });
		expect(textOf(ws, 'a.tji')).toBe(A.replace('1d', '40d'));
		expect(depth(h)).toBe(1);
		h.undo();
		expect(textOf(ws, 'a.tji')).toBe(A);
	});

	it('never join to an earlier step with a paste, Enter or completion', () => {
		for (const userEvent of ['input.paste', 'input', 'input.complete']) {
			const { ws, h } = setup();
			type(ws, 'a.tji', 0, 'a', { time: 0 });
			type(ws, 'a.tji', 1, 'b', { time: 1, userEvent });
			// Typing right after one joins it, as in CodeMirror.
			type(ws, 'a.tji', 2, 'c', { time: 2 });
			expect(depth(h)).toBe(2);
		}
	});

	it('always join a composition update, and transactions without a user event', () => {
		const { ws, h } = setup();
		type(ws, 'a.tji', 0, 'k', { time: 0, userEvent: 'input.type.compose' });
		type(ws, 'a.tji', 0, 'ka', { time: 5000, to: 1, userEvent: 'input.type.compose' });
		const st = ws.state('a.tji');
		const tr = st.update({
			changes: { from: 2, insert: '!' },
			annotations: Transaction.time.of(5001),
		});
		ws.commit('a.tji', tr, 'typing');
		expect(depth(h)).toBe(1);
	});

	it('honour isolateHistory before and after', () => {
		const { ws, h } = setup();
		type(ws, 'a.tji', 0, 'a', { time: 0 });
		type(ws, 'a.tji', 1, 'b', { time: 1, spec: { annotations: isolateHistory.of('before') } });
		// "c" joins "b" and closes the group; "d" starts another.
		type(ws, 'a.tji', 2, 'c', { time: 2, spec: { annotations: isolateHistory.of('after') } });
		type(ws, 'a.tji', 3, 'd', { time: 3 });
		expect(depth(h)).toBe(3);
	});

	it('are not joined after an undo uncovers them', () => {
		const { ws, h } = setup();
		type(ws, 'a.tji', 0, 'a', { time: 0 });
		type(ws, 'b.tji', 0, 'b', { time: 1 });
		h.undo();
		type(ws, 'a.tji', 1, 'c', { time: 2 });
		expect(depth(h)).toBe(2);
	});
});

describe('labelOf', () => {
	it('names attributes and intents', () => {
		expect(labelOf({ type: 'setAttr', task: 't', attr: 'effort', value: '5d' })).toBe('set effort');
		expect(labelOf({ type: 'removeResourceAttr', resource: 'r', attr: 'rate' })).toBe(
			'remove rate',
		);
		expect(labelOf({ type: 'setProjectAttr', attr: 'now', value: '2026-01-01' })).toBe('set now');
		expect(labelOf({ type: 'addDepends', task: 'b', target: 'a' })).toBe('add dependency');
		expect(labelOf({ type: 'format', file: 'a.tji' })).toBe('format');
		expect(labelOf({ type: 'text', file: 'a.tji' })).toBe(historyStrings.edit);
		expect(historyStrings.undoWhat(labelOf({ type: 'deleteTask', task: 't' }))).toBe(
			'Undo: delete task',
		);
	});
});

describe('isTjpEdit', () => {
	it('tells an edit API edit from a bare workspace edit', () => {
		const ws = seedWorkspace();
		const e = plan(ws, { type: 'setAttr', task: 'a.a1', attr: 'effort', value: '2d' });
		if (!e) throw new Error('no edit');
		expect(isTjpEdit(e)).toBe(true);
		expect(isTjpEdit({ id: 'x', intent: { type: 'setAttr' }, base: {}, changes: {} })).toBe(false);
	});
});

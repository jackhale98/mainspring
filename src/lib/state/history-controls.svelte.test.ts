// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { historyStrings } from '../strings';
import { createHistory, type HistoryOutcome } from '../workspace/history';
import { intent, seedWorkspace, type } from '../workspace/testing/history-fixture';
import { HistoryControls } from './history-controls.svelte';

describe('HistoryControls', () => {
	it('follows the history: can-undo, can-redo and the tooltip labels', () => {
		const ws = seedWorkspace();
		const c = new HistoryControls();
		expect([c.canUndo, c.canRedo, c.undoLabel, c.redoLabel]).toEqual([
			false,
			false,
			historyStrings.nothingToUndo,
			historyStrings.nothingToRedo,
		]);
		const heard = vi.fn();
		c.subscribe(heard);
		c.attach(createHistory(ws));
		intent(ws, { type: 'setAttr', task: 'a.a1', attr: 'effort', value: '5d' });
		expect(c.canUndo).toBe(true);
		expect(c.undoLabel).toBe('Undo: set effort');
		expect(c.undo()).toBe(true);
		expect([c.canUndo, c.canRedo, c.redoLabel]).toEqual([false, true, 'Redo: set effort']);
		expect(c.redo()).toBe(true);
		expect(c.redo()).toBe(false);
		expect(heard.mock.calls.length).toBeGreaterThanOrEqual(4);
	});

	it('reports every outcome, and does nothing without a history', () => {
		const outcomes: HistoryOutcome[] = [];
		const c = new HistoryControls((o) => outcomes.push(o));
		expect(c.undo()).toBe(false);
		expect(outcomes).toEqual([]);
		const ws = seedWorkspace();
		const h = createHistory(ws);
		c.attach(h);
		type(ws, 'a.tji', 0, 'x', { time: 1 });
		c.undo();
		c.undo();
		expect(outcomes.map((o) => o.status)).toEqual(['done', 'empty']);
		c.attach(null);
		expect(c.canRedo).toBe(false);
		type(ws, 'a.tji', 0, 'y', { time: 2 });
		expect(c.canUndo).toBe(false);
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
// Step 1 of the dispatcher: the action context it builds, the id a move gives and the id change an
// intent makes (edits-plan.ts).
// The plan and dry run themselves are covered through the dispatcher (edits*.test.ts).
import { describe, expect, it } from 'vitest';
import { manipulation } from '../gantt/intents-testing';
import { createWorkspace } from '../workspace/workspace';
import { contextOf, movedId, renamedBy } from './edits-plan';
import { memoryStorage } from './edits-testing';

describe('movedId', () => {
	it('keeps the local id under the new parent', () => {
		expect(movedId('a.b.c', 'x')).toBe('x.c');
		expect(movedId('a.b', null)).toBe('b');
		expect(movedId('c', 'g.h')).toBe('g.h.c');
	});
});

describe('renamedBy', () => {
	it('names the id change of a move and of a rename with an id', () => {
		expect(renamedBy({ type: 'moveTask', task: 'a.b', parent: 'x', index: 0 })).toEqual([
			'a.b',
			'x.b',
		]);
		expect(renamedBy({ type: 'moveTask', task: 'a.b', parent: 'a', index: 0 })).toBeNull();
		expect(renamedBy({ type: 'renameTask', task: 'g.new_task', name: 'W', id: 'w' })).toEqual([
			'g.new_task',
			'g.w',
		]);
		expect(renamedBy({ type: 'renameTask', task: 'new_task', name: 'W', id: 'w' })).toEqual([
			'new_task',
			'w',
		]);
		expect(renamedBy({ type: 'renameTask', task: 'a', name: 'W' })).toBeNull();
		expect(renamedBy({ type: 'renameTask', task: 'a', name: 'W', id: 'a' })).toBeNull();
		expect(renamedBy({ type: 'text', file: 'plan.tjp' })).toBeNull();
	});
});

describe('contextOf', () => {
	const fx = manipulation();
	const ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': fx.text('plan.tjp') } });
	const runner = { ensureIndex: () => fx.index, subscribe: () => () => undefined };

	it('adds the working time of the result, the zones and the stored move preference', () => {
		const storage = memoryStorage();
		const d = { workspace: ws, runner, storage };
		const ctx = contextOf(d, { result: fx.result, analysis: null }, fx.index);
		expect(ctx.index).toBe(fx.index);
		expect(ctx.wt?.frameEnd).toBe(fx.ctx().wt?.frameEnd);
		expect(ctx.move).toBeNull();
		storage.setItem('mainspring.gantt.move', 'gap');
		expect(contextOf(d, { result: fx.result, analysis: null }, fx.index).move).toEqual({
			kind: 'gap',
		});
		// One working time per result.
		expect(contextOf(d, { result: fx.result, analysis: null }, fx.index).wt).toBe(ctx.wt);
	});

	it('has no working time without a result', () => {
		const ctx = contextOf({ workspace: ws, runner }, { result: null, analysis: null }, fx.index);
		expect(ctx.wt).toBeNull();
		expect(ctx.result).toBeNull();
	});
});

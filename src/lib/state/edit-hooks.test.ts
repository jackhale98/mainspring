// SPDX-License-Identifier: GPL-2.0-or-later
// The end-to-end hook (edit-hooks.ts): installed only on request, and only through the dispatcher.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_HOOKS_KEY, createIndexGate, installEditHooks, type EditHooks } from './edit-hooks';
import { harness, type Harness } from './edits-testing';

let h: Harness;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	h = harness();
	await h.finish();
});
afterEach(() => {
	h.dispose();
	vi.useRealTimers();
});

describe('installEditHooks', () => {
	it('installs nothing without ?hooks=edits', () => {
		const target: Record<string, unknown> = {};
		installEditHooks(
			{ edits: h.edits, run: h.runner.state, workspace: h.ws },
			new URLSearchParams(''),
			target,
		);
		expect(target).toEqual({});
	});

	it('dispatches an action with the newest good result, and records the settlement', async () => {
		const target: Record<string, unknown> = {};
		const off = installEditHooks(
			{ edits: h.edits, run: h.runner.state, workspace: h.ws },
			new URLSearchParams('hooks=edits'),
			target,
		);
		const hooks = target[EDIT_HOOKS_KEY] as EditHooks;
		const o = await hooks.action({ type: 'rename', task: 'b', name: 'Bee' });
		expect(o).toMatchObject({ status: 'applied' });
		expect(o).not.toHaveProperty('settled');
		expect(h.text()).toContain('task b "Bee"');
		expect(hooks.text()).toBe(h.text());
		expect(hooks.text('nope.tji')).toBeNull();
		expect(hooks.revision()).toBe(1);
		expect(hooks.end('b')).toBeNull();
		await h.finish();
		await Promise.resolve();
		expect(hooks.settled).toEqual({ status: 'scheduled' });
		off();
		expect(target).toEqual({});
	});

	it('answers cancelled while no plan is open', async () => {
		const target: Record<string, unknown> = {};
		installEditHooks(
			{ edits: null, run: null, workspace: null },
			new URLSearchParams('hooks=edits'),
			target,
		);
		const hooks = target[EDIT_HOOKS_KEY] as EditHooks;
		await expect(hooks.action({ type: 'delete', task: 'b' })).resolves.toEqual({
			status: 'cancelled',
		});
	});
});

describe('the index gate', () => {
	it("exists only with ?hooks=edits, so production keeps the runner's own timers", () => {
		expect(createIndexGate(new URLSearchParams(''))).toBeNull();
		expect(createIndexGate(new URLSearchParams('hooks=gantt'))).toBeNull();
		expect(createIndexGate(new URLSearchParams('hooks=edits,gantt'))).not.toBeNull();
	});

	it('queues idle tasks while held and runs them on release; a cancelled one never runs', () => {
		const gate = createIndexGate();
		const ran: string[] = [];
		gate.hold();
		gate.timers.requestIdle(() => ran.push('a'), 100);
		const b = gate.timers.requestIdle(() => ran.push('b'), 100);
		gate.timers.cancelIdle(b);
		vi.advanceTimersByTime(1000);
		expect(ran).toEqual([]);
		gate.release();
		vi.advanceTimersByTime(1000);
		expect(ran).toEqual(['a']);
		// Not held: tasks go on as the platform runs them.
		gate.timers.requestIdle(() => ran.push('c'), 100);
		vi.advanceTimersByTime(1000);
		expect(ran).toEqual(['a', 'c']);
	});

	it('holds and releases through the installed hook', () => {
		const gate = createIndexGate();
		const target: Record<string, unknown> = {};
		installEditHooks(
			{ edits: null, run: null, workspace: null },
			new URLSearchParams('hooks=edits'),
			target,
			gate,
		);
		const hooks = target[EDIT_HOOKS_KEY] as EditHooks;
		const ran: number[] = [];
		hooks.holdIndex();
		gate?.timers.requestIdle(() => ran.push(1), 100);
		vi.advanceTimersByTime(1000);
		expect(ran).toEqual([]);
		hooks.releaseIndex();
		vi.advanceTimersByTime(1000);
		expect(ran).toEqual([1]);
	});
});

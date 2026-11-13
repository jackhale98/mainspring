// SPDX-License-Identifier: GPL-2.0-or-later
// The end-to-end hook (edit-hooks.ts): installed only on request, and only through the dispatcher.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_HOOKS_KEY, installEditHooks, type EditHooks } from './edit-hooks';
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

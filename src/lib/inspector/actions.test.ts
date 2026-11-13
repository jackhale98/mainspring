// SPDX-License-Identifier: GPL-2.0-or-later
// The inspector's way into the dispatcher (actions.ts): options passed through, `confirm-shared`
// asked and retried once, a declined question cancelled, and flushing a gesture.
import { describe, expect, it, vi } from 'vitest';
import type { DispatchOutcome, EditDispatcher } from '../state/edits.svelte';
import { InspectorActions } from './actions';
import type { Edit } from './edit';

const edit: Edit = {
	intent: { type: 'renameTask', task: 'a', name: 'B' },
	label: { text: 'Renamed A to B', approx: false },
	constraint: true,
};
const noop: DispatchOutcome = { status: 'noop', reason: 'already-set', message: 'x' };
const shared: DispatchOutcome = { status: 'confirm-shared', affects: ['a', 'b'] };

function env(first: DispatchOutcome, confirm = () => true) {
	const dispatch = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(noop);
	const dispatchAction = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(noop);
	const flush = vi.fn();
	const edits = { dispatch, dispatchAction, flush } as unknown as EditDispatcher;
	const view = { model: {}, result: null, analysis: null, current: true } as never;
	const c = vi.fn(confirm);
	return {
		a: new InspectorActions({ edits: () => edits, view: () => view, confirm: c }),
		dispatch,
		dispatchAction,
		flush,
		c,
	};
}

describe('InspectorActions', () => {
	it('passes the label, the constraint flag and the coalesce key', async () => {
		const e = env(noop);
		await e.a.edit(edit, 'k');
		expect(e.dispatch).toHaveBeenCalledWith(edit.intent, {
			label: edit.label,
			coalesceKey: 'k',
			constraint: true,
		});
	});

	it('asks about a shared declaration and dispatches again with confirmShared', async () => {
		const e = env(shared);
		const o = await e.a.edit(edit);
		expect(e.c).toHaveBeenCalledWith(expect.stringContaining('a, b'));
		expect(e.dispatch).toHaveBeenCalledTimes(2);
		expect(e.dispatch.mock.calls[1]?.[1]).toMatchObject({ confirmShared: true });
		expect(o).toBe(noop);
	});

	it('does nothing more when the question is declined', async () => {
		const e = env(shared, () => false);
		expect((await e.a.edit(edit)).status).toBe('cancelled');
		expect(e.dispatch).toHaveBeenCalledTimes(1);
	});

	it('sends Gantt actions with the shown result as their source, and flushes a gesture', async () => {
		const e = env(noop);
		await e.a.action({ type: 'size-step', task: 'a', steps: 2 }, 'k');
		expect(e.dispatchAction).toHaveBeenCalledWith(
			{ type: 'size-step', task: 'a', steps: 2 },
			{ result: null, analysis: null },
			{ coalesceKey: 'k' },
		);
		e.a.flush('k');
		expect(e.flush).toHaveBeenCalledWith('k');
	});

	it('is cancelled while no plan is open', async () => {
		const a = new InspectorActions({ edits: () => null, view: () => null });
		expect((await a.edit(edit)).status).toBe('cancelled');
		expect((await a.action({ type: 'delete', task: 'a' })).status).toBe('cancelled');
	});
});

// SPDX-License-Identifier: GPL-2.0-or-later
// The Gantt's actor (actor.svelte.ts): an action goes to the dispatcher with the shown result as
// its source and its preview mark; the move question is asked once and answered by the dialog,
// then the same action is sent again; shared text is confirmed first.
import { describe, expect, it, vi } from 'vitest';
import type { GanttAction } from '../../lib/gantt/intents';
import type { DispatchOutcome } from '../../lib/state/edits.svelte';
import { GanttActor } from './actor.svelte';

const applied = { status: 'applied' } as unknown as DispatchOutcome;
const move: GanttAction = { type: 'move', task: 'a', days: 2 };
const shown = { result: null, analysis: null };

function setup(answers: DispatchOutcome[], confirm = () => true) {
	const dispatchAction = vi.fn(async () => answers.shift() ?? applied);
	const setMovePreference = vi.fn();
	const edits = { dispatchAction, setMovePreference, flush: vi.fn(), check: vi.fn(() => null) };
	const actor = new GanttActor({
		app: { edits } as never,
		shown: () => shown,
		confirm,
	});
	return { actor, edits, dispatchAction, setMovePreference };
}

describe('GanttActor.run', () => {
	it('sends the action with the shown source, the options and the preview mark', async () => {
		const { actor, dispatchAction } = setup([applied]);
		const mark = { task: 'a', start: 1, end: 2 };
		const o = await actor.run(move, { coalesceKey: 'k' }, mark);
		expect(o).toBe(applied);
		expect(dispatchAction).toHaveBeenCalledWith(move, shown, { coalesceKey: 'k' }, mark);
	});

	it('asks the move question once, stores the answer, and sends the action again', async () => {
		const { actor, dispatchAction, setMovePreference } = setup([
			{ status: 'ask-move-preference', suggested: 'gap' },
			applied,
		]);
		const p = actor.run(move);
		await vi.waitFor(() => expect(actor.ask).toEqual({ suggested: 'gap' }));
		actor.answer('start');
		expect(await p).toBe(applied);
		expect(setMovePreference).toHaveBeenCalledWith('start');
		expect(dispatchAction).toHaveBeenCalledTimes(2);
		expect(actor.ask).toBeNull();
	});

	it('shares one question between calls made while it is open', async () => {
		const ask: DispatchOutcome = { status: 'ask-move-preference', suggested: 'start' };
		const { actor, setMovePreference } = setup([ask, ask, applied, applied]);
		const a = actor.run(move);
		const b = actor.run({ ...move, days: 3 });
		await vi.waitFor(() => expect(actor.ask).not.toBeNull());
		actor.answer('gap');
		await Promise.all([a, b]);
		expect(setMovePreference).toHaveBeenCalledTimes(2);
		expect(actor.ask).toBeNull();
	});

	it('is cancelled, and changes nothing, when the question is cancelled', async () => {
		const { actor, setMovePreference } = setup([
			{ status: 'ask-move-preference', suggested: 'gap' },
		]);
		const p = actor.run(move);
		await vi.waitFor(() => expect(actor.ask).not.toBeNull());
		actor.answer(null);
		expect(await p).toEqual({ status: 'cancelled' });
		expect(setMovePreference).not.toHaveBeenCalled();
	});

	it('confirms shared text, then sends again with confirmShared; no is cancelled', async () => {
		const shared: DispatchOutcome = { status: 'confirm-shared', affects: ['a', 'b'] };
		const yes = setup([shared, applied]);
		expect(await yes.actor.run(move)).toBe(applied);
		expect(yes.dispatchAction).toHaveBeenLastCalledWith(
			move,
			shown,
			{ confirmShared: true },
			undefined,
		);
		const no = setup([shared], () => false);
		expect(await no.actor.run(move)).toEqual({ status: 'cancelled' });
		expect(no.dispatchAction).toHaveBeenCalledTimes(1);
	});

	it('is cancelled without a dispatcher, and flush and check do nothing', async () => {
		const actor = new GanttActor({ app: { edits: null } as never, shown: () => shown });
		expect(await actor.run(move)).toEqual({ status: 'cancelled' });
		expect(actor.check(move)).toBeNull();
		expect(() => actor.flush('k')).not.toThrow();
	});
});

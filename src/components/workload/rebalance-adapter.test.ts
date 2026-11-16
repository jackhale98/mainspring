// SPDX-License-Identifier: GPL-2.0-or-later
// The rebalance adapter (phase-3.md 6.6, 7.1): with no planner every move says "coming" and sends
// nothing; with one, an intent goes to `dispatch`, a Gantt action to `dispatchAction`, a refusal is
// said and nothing is sent, the move question and the shared-text confirmation are asked and the
// call sent again, and the Alt+arrow keys send cumulative offsets under their coalesce keys.
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import type { ActionContext } from '../../lib/gantt/intents';
import { at, plan } from '../../lib/schedule/testing';
import { availabilityOf } from '../../lib/workload/availability';
import { buildLoad } from '../../lib/workload/load';
import type { PlanRebalanceFn } from '../../lib/workload/rebalance';
import { booking, indexOf, resourceResult, withPeople } from '../../lib/workload/testing';
import { Nudges, PLANNER, Rebalancer, type RebalanceEdits, type RebalanceEnv } from './rebalance-adapter';

const TEXT = `project p "P" 2026-01-05 - 2026-03-02 {
}
resource team "Team" {
  resource dev1 "Dev 1"
  resource dev2 "Dev 2"
}
resource dev3 "Dev 3"
task a "A" { effort 3d allocate dev1 }
`;
const index = indexOf(TEXT);
const result: ScheduleResult = withPeople(
	plan([['a', { start: at(0, 9), end: at(2, 17) }]]),
	[
		resourceResult('team', { group: true }),
		resourceResult('dev1', { parent: 'team' }),
		resourceResult('dev2', { parent: 'team' }),
		resourceResult('dev3'),
	],
	[booking('dev1', 'a', [[at(0, 9), at(0, 17)]])],
);
const model = buildLoad({
	result,
	index,
	zones: createTimeZoneHost(),
	kind: 'week',
	collapsed: new Set(),
	availability: availabilityOf(result, 'plan'),
	demand: null,
});
const row = (id: string): number => model.rows.findIndex((r) => r.id === id);

function fakeEdits(outcomes: Array<Record<string, unknown>> = []) {
	const calls: Array<{ op: string; args: unknown[] }> = [];
	const queue = [...outcomes];
	const next = async () =>
		(queue.shift() ?? { status: 'applied' }) as unknown as Awaited<
			ReturnType<RebalanceEdits['dispatch']>
		>;
	const edits: RebalanceEdits = {
		dispatch: async (...args) => {
			calls.push({ op: 'dispatch', args });
			return next();
		},
		dispatchAction: async (...args) => {
			calls.push({ op: 'dispatchAction', args });
			return next();
		},
		setMovePreference: (...args) => void calls.push({ op: 'setMovePreference', args }),
		flush: (...args) => void calls.push({ op: 'flush', args }),
		say: (...args) => void calls.push({ op: 'say', args }),
	};
	return { edits, calls };
}

const ctx = { index, result } as unknown as ActionContext;
function env(planner: PlanRebalanceFn | null, edits: RebalanceEdits | null, over: Partial<RebalanceEnv> = {}) {
	const e: RebalanceEnv = {
		planner,
		edits: () => edits,
		context: () => ctx,
		source: () => ({ result, analysis: null }),
		askMove: async () => 'start',
		confirm: () => true,
		...over,
	};
	return e;
}

const intentPlanner: PlanRebalanceFn = (a) =>
	a.type === 'reassign'
		? {
				status: 'intent',
				intent: { type: 'replaceAllocation', task: a.task, from: a.from, to: a.to } as never,
				label: { text: 'Moved', approx: false },
			}
		: { status: 'action', action: { type: 'move', task: a.task, days: 5 } };

describe('rebalance adapter', () => {
	it('has no planner until T12 merges, and says so without sending anything', async () => {
		expect(PLANNER).toBeNull();
		const { edits, calls } = fakeEdits();
		const r = new Rebalancer(env(PLANNER, edits));
		expect(r.ready).toBe(false);
		const out = await r.run({ type: 'reassign', task: 'a', from: 'dev1', to: 'dev3' });
		expect(out.status).toBe('coming');
		expect(calls.map((c) => c.op)).toEqual(['say']);
		expect(calls[0]?.args[0]).toBe('Moving tasks between people and weeks is coming. Nothing was changed.');
	});

	it('does nothing without a dispatcher or a context', async () => {
		const none = new Rebalancer(env(intentPlanner, null));
		expect((await none.run({ type: 'reassign', task: 'a', from: 'dev1', to: 'dev3' })).status).toBe(
			'unavailable',
		);
		const { edits, calls } = fakeEdits();
		const noCtx = new Rebalancer(env(intentPlanner, edits, { context: () => null }));
		expect((await noCtx.run({ type: 'shift', task: 'a', fromBucket: 0, toBucket: 1 })).status).toBe(
			'unavailable',
		);
		expect(calls).toEqual([]);
	});

	it('sends a reassign intent with its label and an action through the action path', async () => {
		const { edits, calls } = fakeEdits();
		const r = new Rebalancer(env(intentPlanner, edits));
		expect(r.ready).toBe(true);
		const a = await r.run({ type: 'reassign', task: 'a', from: 'dev1', to: 'dev3' });
		expect(a).toMatchObject({ status: 'sent', outcome: { status: 'applied' } });
		expect(calls[0]).toMatchObject({ op: 'dispatch' });
		expect(calls[0]?.args[1]).toMatchObject({ label: { text: 'Moved' }, confirmShared: false });
		await r.run({ type: 'shift', task: 'a', fromBucket: 0, toBucket: 10080 }, { coalesceKey: 'k' });
		expect(calls[1]).toMatchObject({ op: 'dispatchAction' });
		expect(calls[1]?.args[0]).toEqual({ type: 'move', task: 'a', days: 5 });
		expect(calls[1]?.args[2]).toMatchObject({ coalesceKey: 'k' });
	});

	it('says the planner refusal and sends nothing', async () => {
		const { edits, calls } = fakeEdits();
		const planner: PlanRebalanceFn = () => ({ status: 'not-possible', reason: 'via-group', at: [] });
		const out = await new Rebalancer(env(planner, edits)).run({
			type: 'reassign',
			task: 'a',
			from: 'dev1',
			to: 'dev3',
		});
		expect(out).toEqual({
			status: 'refused',
			message: "Booked through a group. Change the task's people in its details.",
		});
		expect(calls.map((c) => c.op)).toEqual(['say']);
	});

	it('asks the move question, stores the answer and sends again', async () => {
		const { edits, calls } = fakeEdits([{ status: 'ask-move-preference', suggested: 'gap' }]);
		const askMove = vi.fn(async () => 'gap' as const);
		const out = await new Rebalancer(env(intentPlanner, edits, { askMove })).run({
			type: 'shift',
			task: 'a',
			fromBucket: 0,
			toBucket: 1,
		});
		expect(askMove).toHaveBeenCalledWith('gap');
		expect(calls.map((c) => c.op)).toEqual(['dispatchAction', 'setMovePreference', 'dispatchAction']);
		expect(out).toMatchObject({ status: 'sent', outcome: { status: 'applied' } });
	});

	it('cancels when the question is dismissed or the shared text is not confirmed', async () => {
		const q = fakeEdits([{ status: 'ask-move-preference', suggested: 'start' }]);
		const cancelled = await new Rebalancer(env(intentPlanner, q.edits, { askMove: async () => null })).run({
			type: 'shift',
			task: 'a',
			fromBucket: 0,
			toBucket: 1,
		});
		expect(cancelled).toMatchObject({ outcome: { status: 'cancelled' } });
		expect(q.calls.map((c) => c.op)).toEqual(['dispatchAction']);
		const s = fakeEdits([{ status: 'confirm-shared', affects: ['dev1', 'dev2'] }]);
		const no = await new Rebalancer(env(intentPlanner, s.edits, { confirm: () => false })).run({
			type: 'reassign',
			task: 'a',
			from: 'dev1',
			to: 'dev3',
		});
		expect(no).toMatchObject({ outcome: { status: 'cancelled' } });
		const yes = fakeEdits([{ status: 'confirm-shared', affects: ['dev1'] }]);
		await new Rebalancer(env(intentPlanner, yes.edits)).run({
			type: 'reassign',
			task: 'a',
			from: 'dev1',
			to: 'dev3',
		});
		expect(yes.calls[1]?.args[1]).toMatchObject({ confirmShared: true });
	});
});

describe('Alt+arrow nudges', () => {
	it('sends the cumulative person offset under one coalesce key', async () => {
		const { edits, calls } = fakeEdits();
		const n = new Nudges(new Rebalancer(env(intentPlanner, edits)));
		const cell = { row: row('dev1'), col: 0 };
		await n.person(model, 'a', cell, 1);
		await n.person(model, 'a', cell, 1);
		const sent = calls.filter((c) => c.op === 'dispatch').map((c) => c.args[0] as { to: string });
		expect(sent.map((i) => i.to)).toEqual(['dev2', 'dev3']);
		expect(calls[0]?.args[1]).toMatchObject({ coalesceKey: 'rebalance:a:dev1' });
		// Past the last person nothing is sent.
		expect(await n.person(model, 'a', cell, 1)).toBeNull();
		expect(await n.person(model, 'a', { row: row('team'), col: 0 }, 1)).toBeNull();
	});

	it('sends the cumulative bucket offset, and stops at the edges', async () => {
		const { edits, calls } = fakeEdits();
		const n = new Nudges(new Rebalancer(env(intentPlanner, edits)));
		const cell = { row: row('dev1'), col: 0 };
		expect(await n.period(model, 'a', cell, -1)).toBeNull();
		await n.period(model, 'a', cell, 1);
		await n.period(model, 'a', cell, 1);
		const last = calls.filter((c) => c.op === 'dispatchAction').at(-1);
		expect(last?.args[2]).toMatchObject({ coalesceKey: 'shift:a' });
	});

	it('starts again from zero after the gesture ends, and flushes the dispatcher', async () => {
		const { edits, calls } = fakeEdits();
		const n = new Nudges(new Rebalancer(env(intentPlanner, edits)));
		const cell = { row: row('dev1'), col: 0 };
		await n.person(model, 'a', cell, 1);
		n.end();
		expect(calls.at(-1)).toMatchObject({ op: 'flush' });
		await n.person(model, 'a', cell, 1);
		const to = calls.filter((c) => c.op === 'dispatch').map((c) => (c.args[0] as { to: string }).to);
		expect(to).toEqual(['dev2', 'dev2']);
	});
});

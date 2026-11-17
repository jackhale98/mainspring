// SPDX-License-Identifier: GPL-2.0-or-later
// What the heatmap and the lanes share of rebalancing (rebalance-host.svelte.ts, phase-3.md 6.6,
// 18.9): a drop of one movable task plans it at once, a drop of several asks "Move which task?"
// and the answer plans the chosen one, Escape drops the move and says so, the move question is
// answered through a promise, and without a result or a dispatcher nothing is sent. The planner and
// the dispatcher themselves are tested with the adapter (rebalance-adapter.test.ts).
import { describe, expect, it, vi } from 'vitest';
import { createTimeZoneHost } from '../../engine/timezone';
import type { AppState } from '../../lib/state/app.svelte';
import type { CellTask } from '../../lib/workload/types';
import type { HeatHost } from './heat-gestures.svelte';
import type { HeatState } from './heat-state.svelte';
import { RebalanceHost } from './rebalance-host.svelte';

function host() {
	const announce = vi.fn();
	const app = { edits: null, index: null, workspace: null } as unknown as AppState;
	const loads = { built: null, zones: createTimeZoneHost() } as unknown as HeatState;
	const names = new Map([
		['t1', 'Login'],
		['t2', 'Report'],
	]);
	const h = new RebalanceHost({ app, loads, taskNames: () => names, announce });
	return { h, announce };
}

const task = (id: string, minutes: number, movable = true): CellTask => ({
	task: id,
	minutes,
	kind: 'booked',
	movable,
});

type Drop = Parameters<HeatHost['drop']>[0];
const dropOf = (tasks: CellTask[], plan: Drop['plan']): Drop => ({
	from: { row: 0, col: 0 },
	to: { row: 1, col: 0 },
	tasks,
	plan,
});

describe('RebalanceHost drop', () => {
	it('plans one movable task at once, with no question', () => {
		const { h } = host();
		const plan = vi.fn(() => ({ action: null, ok: true, label: 'To Bo' }));
		h.drop(dropOf([task('t1', 480)], plan));
		expect(plan).toHaveBeenCalledWith(expect.objectContaining({ task: 't1' }));
		expect(h.which).toBeNull();
	});

	it('does nothing for a cell with nothing to move', () => {
		const { h } = host();
		const plan = vi.fn(() => ({ action: null, ok: true, label: '' }));
		h.drop(dropOf([task('t1', 480, false)], plan));
		expect(plan).not.toHaveBeenCalled();
		expect(h.which).toBeNull();
	});

	it('asks which task for several, with names and hours, and plans the one chosen', () => {
		const { h } = host();
		const plan = vi.fn((t: CellTask | null) => ({
			action: t ? ({ type: 'reassign', task: t.task, from: 'a', to: 'b' } as const) : null,
			ok: true,
			label: 'To Bo',
		}));
		h.drop(dropOf([task('t1', 480), task('t2', 240)], plan));
		expect(h.which?.label).toBe('To Bo');
		expect(h.which?.tasks).toEqual([
			{ task: 't1', name: 'Login', minutes: 480 },
			{ task: 't2', name: 'Report', minutes: 240 },
		]);
		h.choose('t2');
		expect(h.which).toBeNull();
		expect(plan).toHaveBeenLastCalledWith(expect.objectContaining({ task: 't2' }));
	});

	it('says the move was cancelled when the question is dismissed', () => {
		const { h, announce } = host();
		h.drop(
			dropOf([task('t1', 480), task('t2', 240)], () => ({ action: null, ok: true, label: '' })),
		);
		h.cancelWhich();
		expect(h.which).toBeNull();
		expect(announce).toHaveBeenCalledWith('Move cancelled.');
	});
});

describe('RebalanceHost without a plan to edit', () => {
	it('has no planner context, and no dry run, before a result and an index', () => {
		const { h } = host();
		expect(h.context()).toBeNull();
		expect(h.check({ type: 'reassign', task: 't1', from: 'a', to: 'b' })).toBeNull();
	});

	it('sends nothing and keeps no note when there is no dispatcher', async () => {
		const { h } = host();
		await h.perform({ type: 'reassign', task: 't1', from: 'a', to: 'b' });
		expect(h.note).toBe('');
		await h.perform(null);
		expect(h.note).toBe('');
	});

	it('answers the move question through the promise a dispatch waits on', () => {
		const { h } = host();
		h.moveAsk = { suggested: 'start' };
		h.answerMove('gap');
		expect(h.moveAsk).toBeNull();
	});
});

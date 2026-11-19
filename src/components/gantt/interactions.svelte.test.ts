// SPDX-License-Identifier: GPL-2.0-or-later
// The Gantt's row commands (interactions.svelte.ts; ADR-0018): a step and an add are planners the
// dispatcher runs on the text now, at an edge of the shown tree nothing is sent and the view says
// so, a drop carries the version of the outline it was read from, and the focus follows the move
// the edit made, not the view's guess.
import { describe, expect, it, vi } from 'vitest';
import type { GanttModel } from '../../lib/gantt/model';
import type { AppState } from '../../lib/state/app.svelte';
import type { DispatchOutcome, ViewPlanner } from '../../lib/state/edits.svelte';
import { buildOutline } from '../../lib/state/outline';
import { gestureStrings } from '../../lib/strings';
import type { EditIntent } from '../../lib/tjp/edit/types';
import { indexOf } from '../../lib/workload/testing';
import { GanttInteractions, type InteractionHost } from './interactions.svelte';

const TEXT = `project p "P" 2026-01-05 +8w
task a "A" { effort 1d }
task g "G" {
  task b "B" { effort 1d }
  task c "C" { effort 1d }
}
`;

const appliedWith = (intent: EditIntent): DispatchOutcome =>
	({ status: 'applied', edit: { intent } }) as unknown as DispatchOutcome;

function rig(outcome: DispatchOutcome = { status: 'cancelled' }) {
	const index = indexOf(TEXT);
	const outline = buildOutline(index);
	const plans: ViewPlanner[] = [];
	const actions: Array<{ action: unknown; o: unknown }> = [];
	const said: string[] = [];
	const focused: string[] = [];
	const edits = {
		dispatchPlan: vi.fn(async (plan: ViewPlanner) => (plans.push(plan), outcome)),
		dispatchAction: vi.fn(async (action: unknown, _s: unknown, o: unknown) => {
			actions.push({ action, o });
			return outcome;
		}),
		flush: vi.fn(),
	};
	const host = {
		app: { edits, outline, inspector: { link: null } } as unknown as AppState,
		model: () =>
			({
				rows: [],
				rowOf: new Map(),
			}) as unknown as GanttModel,
		shown: () => ({ result: null, analysis: null }),
		ctx: () => null,
		wt: () => null,
		reveal: async () => {},
		today: () => true,
		focusRowSoon: (k: string) => void focused.push(k),
		announce: (t: string) => void said.push(t),
	} as InteractionHost;
	return { i: new GanttInteractions(host), edits, plans, actions, said, focused, index, outline };
}

describe('reorder', () => {
	it('sends a planner that moves the task, and plans it on the text now', async () => {
		const r = rig(appliedWith({ type: 'moveTask', task: 'a', parent: null, index: 1 }));
		await r.i.reorder('task:a', 'down');
		expect(r.edits.dispatchPlan).toHaveBeenCalledTimes(1);
		expect(r.edits.dispatchAction).not.toHaveBeenCalled();
		// The planner reads the base it is given: here the same text.
		const on = {
			snap: { version: r.index.version },
			index: r.index,
			outline: () => r.outline,
			mapRange: (x: unknown) => x,
			isSame: () => true,
		};
		expect(r.plans[0]?.(on as never)).toMatchObject({
			status: 'intent',
			intent: { type: 'moveTask', task: 'a' },
		});
	});

	it('says there is nowhere to go at an edge of the shown tree, and sends nothing', async () => {
		const r = rig();
		expect(await r.i.reorder('task:a', 'up')).toBeNull();
		expect(r.said).toEqual([gestureStrings.live.noPlace]);
		expect(r.edits.dispatchPlan).not.toHaveBeenCalled();
	});

	it('gives the focus to the row under the id the edit gave the task (an outdent makes a new id)', async () => {
		const r = rig(appliedWith({ type: 'moveTask', task: 'g.b', parent: null, index: 2 }));
		await r.i.reorder('task:g.b', 'outdent');
		expect(r.focused).toEqual(['task:b']);
	});

	it('gives the focus to the same key when the id stays', async () => {
		const r = rig(appliedWith({ type: 'moveTask', task: 'g.b', parent: 'g', index: 1 }));
		await r.i.reorder('task:g.b', 'down');
		expect(r.focused).toEqual(['task:g.b']);
	});

	it('moves focus nowhere when the step was not applied', async () => {
		const r = rig({ status: 'noop', reason: 'already-set', message: 'm' });
		await r.i.reorder('task:a', 'down');
		expect(r.focused).toEqual([]);
	});
});

describe('moveTo (a row drop)', () => {
	it('carries the version of the outline the place was read from', async () => {
		const r = rig();
		await r.i.moveTo('task:a', 'g', 0);
		expect(r.actions[0]?.action).toEqual({ type: 'reorder', task: 'a', parent: 'g', index: 0 });
		expect(r.actions[0]?.o).toMatchObject({ defer: true, basedOn: r.outline.version });
	});
});

describe('add', () => {
	it('says there is no place for a row with no id, and sends nothing', async () => {
		const r = rig();
		await r.i.add('task:unresolved:0');
		expect(r.said).toEqual([gestureStrings.live.noAddPlace]);
		expect(r.edits.dispatchPlan).not.toHaveBeenCalled();
	});

	it('sends a planner for a task after the row, not a place from the shown tree', async () => {
		const r = rig();
		await r.i.add('task:a');
		expect(r.edits.dispatchPlan).toHaveBeenCalledTimes(1);
		expect(r.edits.dispatchAction).not.toHaveBeenCalled();
	});
});

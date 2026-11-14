// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { GanttAction } from '../../lib/gantt/intents';
import type { DispatchOutcome } from '../../lib/state/edits.svelte';
import type { Settlement } from '../../lib/state/edits-settle';
import type { OutlineNode } from '../../lib/state/outline';
import { addTaskFlow, type AddFlowApp, type AddFlowEnv } from './add-task-flow';

const node = (key: string, parent: string | null, children: string[] = []): OutlineNode =>
	({ key, id: key.slice(5), parent, children }) as unknown as OutlineNode;

/** a, b (child b1): the outline the flow reads, which `grow` adds one node to. */
function outline(): { tasks: OutlineNode[]; byKey: Map<string, OutlineNode> } {
	const tasks = [
		node('task:a', null),
		node('task:b', null, ['task:b.b1']),
		node('task:b.b1', 'task:b'),
	];
	return { tasks, byKey: new Map(tasks.map((n) => [n.key, n])) };
}

const applied = (settled: Settlement): DispatchOutcome =>
	({ status: 'applied', settled: Promise.resolve(settled) }) as unknown as DispatchOutcome;

function rig(
	selected: string | null,
	outcome: DispatchOutcome,
	newKey: string,
	parent: string | null,
) {
	const o = outline();
	const calls: GanttAction[] = [];
	const picked: string[] = [];
	const events: string[] = [];
	const app: AddFlowApp = {
		get outline() {
			return o;
		},
		selectedTask: selected,
		selectTask: (k) => void (picked.push(k), events.push('select')),
		inspector: { focusName: () => void events.push('focus') },
	};
	const env: AddFlowEnv = {
		app,
		run: (a) => {
			calls.push(a);
			// The index follows the text: the node is in the outline when the run has settled.
			if (outcome.status === 'applied') {
				const n = node(newKey, parent);
				o.tasks.push(n);
				o.byKey.set(n.key, n);
			}
			return Promise.resolve(outcome);
		},
		reveal: () => void events.push('reveal'),
		pause: () => Promise.resolve(),
	};
	return { env, calls, picked, events };
}

describe('addTaskFlow', () => {
	it('adds after the selected task, then selects it, reveals it and focuses the name', async () => {
		const r = rig('task:a', applied({ status: 'scheduled' }), 'task:new_task', null);
		await expect(addTaskFlow(r.env, 'after')).resolves.toBe('task:new_task');
		expect(r.calls).toEqual([{ type: 'add', parent: null, index: 1, name: 'New task' }]);
		expect(r.picked).toEqual(['task:new_task']);
		expect(r.events).toEqual(['select', 'reveal', 'focus']);
	});

	it('adds at the end of the plan when nothing is selected', async () => {
		const r = rig(null, applied({ status: 'scheduled' }), 'task:new_task', null);
		await addTaskFlow(r.env, 'after');
		expect(r.calls[0]).toMatchObject({ parent: null, index: 2 });
	});

	it('adds a subtask as the last child of the selected task', async () => {
		const r = rig('task:b', applied({ status: 'scheduled' }), 'task:b.new_task', 'task:b');
		await expect(addTaskFlow(r.env, 'subtask')).resolves.toBe('task:b.new_task');
		expect(r.calls).toEqual([{ type: 'add', parent: 'b', index: 1, name: 'New task' }]);
	});

	it('still selects the new task when the plan does not schedule with it', async () => {
		const r = rig(
			null,
			applied({ status: 'not-scheduled', message: 'no', at: null }),
			'task:new_task',
			null,
		);
		await expect(addTaskFlow(r.env, 'after')).resolves.toBe('task:new_task');
	});

	it('does nothing more after a refusal', async () => {
		const refused: DispatchOutcome = {
			status: 'refused',
			reason: 'conflicting-attribute',
			at: [],
			message: 'no',
		} as unknown as DispatchOutcome;
		const r = rig('task:a', refused, 'task:x', null);
		await expect(addTaskFlow(r.env, 'subtask')).resolves.toBeNull();
		expect(r.events).toEqual([]);
	});

	it('does nothing when the edit was undone before the result came', async () => {
		const r = rig('task:a', applied({ status: 'undone' }), 'task:x', null);
		await expect(addTaskFlow(r.env, 'after')).resolves.toBeNull();
		expect(r.events).toEqual([]);
	});

	it('sends no edit for a subtask without a selection', async () => {
		const r = rig(null, applied({ status: 'scheduled' }), 'task:x', null);
		const run = vi.spyOn(r.env, 'run');
		await expect(addTaskFlow(r.env, 'subtask')).resolves.toBeNull();
		expect(run).not.toHaveBeenCalled();
	});

	it('works in an empty plan', async () => {
		const o = { tasks: [] as OutlineNode[], byKey: new Map<string, OutlineNode>() };
		const calls: GanttAction[] = [];
		const env: AddFlowEnv = {
			app: {
				outline: o,
				selectedTask: null,
				selectTask: () => undefined,
				inspector: { focusName: () => undefined },
			},
			run: (a) => {
				calls.push(a);
				const n = node('task:new_task', null);
				o.tasks.push(n);
				return Promise.resolve(applied({ status: 'scheduled' }));
			},
			reveal: () => undefined,
			pause: () => Promise.resolve(),
		};
		await expect(addTaskFlow(env, 'after')).resolves.toBe('task:new_task');
		expect(calls).toEqual([{ type: 'add', parent: null, index: 0, name: 'New task' }]);
	});
});

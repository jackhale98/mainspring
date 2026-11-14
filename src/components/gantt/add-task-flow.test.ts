// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { DispatchOutcome } from '../../lib/state/edits.svelte';
import type { Settlement } from '../../lib/state/edits-settle';
import type { OutlineNode } from '../../lib/state/outline';
import { addTaskFlow, type AddFlowApp, type AddFlowEnv } from './add-task-flow';

const node = (key: string, parent: string | null, children: string[] = []): OutlineNode =>
	({ key, id: key.slice(5), parent, children }) as unknown as OutlineNode;

type Outline = { tasks: OutlineNode[]; byKey: Map<string, OutlineNode> };
const put = (o: Outline, n: OutlineNode): void => void (o.tasks.push(n), o.byKey.set(n.key, n));

/** a, b (child b1): the outline the flow reads. */
function outline(): Outline {
	const tasks = [
		node('task:a', null),
		node('task:b', null, ['task:b.b1']),
		node('task:b.b1', 'task:b'),
	];
	return { tasks, byKey: new Map(tasks.map((n) => [n.key, n])) };
}

const applied = (settled: Settlement | Promise<Settlement>): DispatchOutcome =>
	({
		status: 'applied',
		edit: {},
		settled: Promise.resolve(settled),
	}) as unknown as DispatchOutcome;

interface Rig {
	env: AddFlowEnv;
	out: Outline;
	calls: unknown[];
	events: string[];
	picked: string[];
	plan: { current: unknown };
}

/**
 * `header` is the text of the edit's header; `lands` is the node the index gets when the edit's
 * result is in (a task the text has, the outline lags).
 */
function rig(
	selected: string | null,
	outcome: DispatchOutcome,
	header: string | null,
	lands: OutlineNode | null,
	over: Partial<AddFlowEnv> = {},
): Rig {
	const out = outline();
	const calls: unknown[] = [];
	const picked: string[] = [];
	const events: string[] = [];
	const plan = { current: {} as unknown };
	const app: AddFlowApp = {
		get outline() {
			return out;
		},
		selectedTask: selected,
		selectTask: (k) => void (picked.push(k), events.push('select')),
		inspector: { focusName: () => void events.push('focus') },
	};
	const env: AddFlowEnv = {
		app,
		plan: () => plan.current,
		add: (a) => {
			calls.push(a);
			if (outcome.status === 'applied' && lands) put(out, lands);
			return Promise.resolve(outcome);
		},
		headerOf: () => header,
		reveal: () => void events.push('reveal'),
		pause: () => Promise.resolve(),
		...over,
	};
	return { env, out, calls, events, picked, plan };
}

const OK = applied({ status: 'scheduled' });
const HEADER = 'task new_task "New task"';

describe('addTaskFlow', () => {
	it('adds after the selected task, then selects it, reveals it and focuses the name', async () => {
		const r = rig('task:a', OK, HEADER, node('task:new_task', null));
		await expect(addTaskFlow(r.env, 'after')).resolves.toBe('task:new_task');
		expect(r.calls).toEqual([{ parent: null, index: 1, name: 'New task' }]);
		expect(r.picked).toEqual(['task:new_task']);
		expect(r.events).toEqual(['select', 'reveal', 'focus']);
	});

	it('adds at the end of the plan when nothing is selected', async () => {
		const r = rig(null, OK, HEADER, node('task:new_task', null));
		await addTaskFlow(r.env, 'after');
		expect(r.calls[0]).toMatchObject({ parent: null, index: 2 });
	});

	it('adds a subtask as the last child of the selected task', async () => {
		const r = rig('task:b', OK, 'task new_task "New task"', node('task:b.new_task', 'task:b'));
		await expect(addTaskFlow(r.env, 'subtask')).resolves.toBe('task:b.new_task');
		expect(r.calls).toEqual([{ parent: 'b', index: 1, name: 'New task' }]);
	});

	it('still selects the new task when the plan does not schedule with it', async () => {
		const r = rig(
			null,
			applied({ status: 'not-scheduled', message: 'no', at: null }),
			HEADER,
			node('task:new_task', null),
		);
		await expect(addTaskFlow(r.env, 'after')).resolves.toBe('task:new_task');
	});

	it('picks the new task from the edit, not from what the outline gained: a task typed meanwhile', async () => {
		// (a) The text got another task a moment before + was pressed: the outline lags, then gains
		// both at once, the typed one first. The edit's own header names the right one.
		const r = rig('task:a', OK, 'task new_task2 "New task"', node('task:new_task2', null), {
			add: (a) => {
				r.calls.push(a);
				put(r.out, node('task:typed', null));
				put(r.out, node('task:new_task2', null));
				return Promise.resolve(OK);
			},
		});
		await expect(addTaskFlow(r.env, 'after')).resolves.toBe('task:new_task2');
		expect(r.picked).toEqual(['task:new_task2']);
	});

	it('waits for the index to gain the new task', async () => {
		const r = rig('task:a', OK, HEADER, null);
		let looks = 0;
		r.env = {
			...r.env,
			pause: () => {
				if (++looks === 3) put(r.out, node('task:new_task', null));
				return Promise.resolve();
			},
		};
		await expect(addTaskFlow(r.env, 'after')).resolves.toBe('task:new_task');
		expect(looks).toBe(3);
	});

	it('gives up when another plan has been opened meanwhile', async () => {
		// (c) The person switched to another sample while the edit was settling.
		const r = rig('task:a', OK, HEADER, node('task:new_task', null));
		const add = r.env.add;
		r.env = {
			...r.env,
			add: async (a) => {
				const o = await add(a);
				r.plan.current = {};
				return o;
			},
		};
		await expect(addTaskFlow(r.env, 'after')).resolves.toBeNull();
		expect(r.events).toEqual([]);
	});

	it('gives up when the plan changes while it waits for the new task', async () => {
		const r = rig('task:a', OK, HEADER, null);
		r.env = {
			...r.env,
			pause: () => {
				r.plan.current = {};
				return Promise.resolve();
			},
		};
		await expect(addTaskFlow(r.env, 'after')).resolves.toBeNull();
		expect(r.events).toEqual([]);
	});

	it('does nothing more after a refusal', async () => {
		const refused = {
			status: 'refused',
			reason: 'conflicting-attribute',
			at: [],
			message: 'no',
		} as unknown as DispatchOutcome;
		const r = rig('task:a', refused, HEADER, null);
		await expect(addTaskFlow(r.env, 'subtask')).resolves.toBeNull();
		expect(r.events).toEqual([]);
	});

	it('does nothing when the edit was undone before the result came', async () => {
		const r = rig('task:a', applied({ status: 'undone' }), HEADER, node('task:new_task', null));
		await expect(addTaskFlow(r.env, 'after')).resolves.toBeNull();
		expect(r.events).toEqual([]);
	});

	it('does nothing when the edit has no header to read', async () => {
		const r = rig('task:a', OK, null, node('task:new_task', null));
		await expect(addTaskFlow(r.env, 'after')).resolves.toBeNull();
		expect(r.events).toEqual([]);
	});

	it('sends no edit for a subtask without a selection', async () => {
		const r = rig(null, OK, HEADER, node('task:new_task', null));
		const add = vi.spyOn(r.env, 'add');
		await expect(addTaskFlow(r.env, 'subtask')).resolves.toBeNull();
		expect(add).not.toHaveBeenCalled();
	});

	it('shows the details host first, and stops when the person has gone elsewhere', async () => {
		const order = rig('task:a', OK, HEADER, node('task:new_task', null), {
			show: () => Promise.resolve(true),
		});
		const events = order.events;
		order.env = { ...order.env, show: () => (events.push('show'), Promise.resolve(true)) };
		await addTaskFlow(order.env, 'after');
		expect(events).toEqual(['show', 'select', 'reveal', 'focus']);

		const away = rig('task:a', OK, HEADER, node('task:new_task', null), {
			show: () => Promise.resolve(false),
		});
		await expect(addTaskFlow(away.env, 'after')).resolves.toBeNull();
		expect(away.events).toEqual([]);
	});

	it('ignores a second press while one add is under way', async () => {
		const r = rig(null, OK, HEADER, node('task:new_task', null));
		const first = addTaskFlow(r.env, 'after');
		const second = addTaskFlow(r.env, 'after');
		await expect(second).resolves.toBeNull();
		await expect(first).resolves.toBe('task:new_task');
		expect(r.calls).toHaveLength(1);
		// Released when the first resolved.
		const again = rig(null, OK, HEADER, node('task:new_task', null));
		await expect(addTaskFlow(again.env, 'after')).resolves.toBe('task:new_task');
	});

	it('works in an empty plan', async () => {
		const r = rig(null, OK, HEADER, node('task:new_task', null));
		r.out.tasks.length = 0;
		r.out.byKey.clear();
		await expect(addTaskFlow(r.env, 'after')).resolves.toBe('task:new_task');
		expect(r.calls).toEqual([{ parent: null, index: 0, name: 'New task' }]);
	});
});

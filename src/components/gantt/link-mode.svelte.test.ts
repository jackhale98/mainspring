// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { ActionOutcome, GanttAction } from '../../lib/gantt/intents';
import { modelOf, row } from '../../lib/gantt/testing';
import { LinkMode } from './link-mode.svelte';

const model = modelOf([row(0, 0, 100), row(1, 0, 100), row(2, 0, 100, 'task', { id: null })]);

function setup(answer: (a: GanttAction) => ActionOutcome | null) {
	const said: string[] = [];
	const ran: GanttAction[] = [];
	const queue: Array<() => void> = [];
	const check = vi.fn(answer);
	const mode = new LinkMode({
		model: () => model,
		check,
		run: async (a) => {
			ran.push(a);
			return { status: 'cancelled' };
		},
		announce: (t) => said.push(t),
		later: (task) => {
			queue.push(task);
			return () => queue.splice(queue.indexOf(task), 1);
		},
	});
	return { mode, said, ran, check, flush: () => queue.splice(0).forEach((t) => t()) };
}

const allowed = {
	status: 'edit',
} as unknown as ActionOutcome;
const refused = (message: string): ActionOutcome => ({
	status: 'refused',
	intent: null,
	reason: 'cycle',
	at: [],
	message,
});

describe('LinkMode', () => {
	it('begins at a row, announces it, and cannot begin at a task with no id', () => {
		const { mode, said } = setup(() => allowed);
		expect(mode.begin(2, 'tap')).toBe(false);
		expect(mode.active).toBe(false);
		expect(mode.begin(0, 'tap')).toBe(true);
		expect(mode.state).toMatchObject({ from: 0, task: 't0', via: 'tap', target: null });
		expect(said).toEqual(['Linking from Task 0. Choose the task that comes after it.']);
	});

	it('judges a target once, after the target changes, in a task of its own', () => {
		const { mode, check, flush } = setup(() => allowed);
		mode.begin(0, 'drag');
		mode.target(1);
		expect(check).not.toHaveBeenCalled();
		mode.target(1);
		flush();
		expect(check).toHaveBeenCalledTimes(1);
		expect(check).toHaveBeenCalledWith({ type: 'link', pred: 't0', succ: 't1' });
		expect(mode.state).toMatchObject({ target: 1, ok: true, message: 'Task 1 will wait for Task 0' });
	});

	it('says why a target is not allowed, and forgets a verdict of a target left behind', () => {
		const answers: Record<string, ActionOutcome> = { t1: refused('That would loop.') };
		const { mode, flush } = setup((a) => (a.type === 'link' ? (answers[a.succ] ?? allowed) : null));
		mode.begin(0, 'drag');
		mode.target(1);
		mode.target(null);
		flush();
		expect(mode.state).toMatchObject({ target: null, ok: null });
		mode.target(1);
		flush();
		expect(mode.state).toMatchObject({ ok: false, message: 'Not allowed: That would loop.' });
	});

	it('announces each target in the keyboard mode', () => {
		const { mode, said, flush } = setup(() => allowed);
		mode.begin(0, 'key');
		mode.target(1);
		flush();
		expect(said.at(-1)).toBe('Task 1: allowed');
	});

	it('links on completion, and leaves the mode', async () => {
		const { mode, ran } = setup(() => allowed);
		mode.begin(0, 'tap');
		await mode.complete(1);
		expect(ran).toEqual([{ type: 'link', pred: 't0', succ: 't1' }]);
		expect(mode.active).toBe(false);
	});

	it('cancels without linking, and says so', () => {
		const { mode, ran, said } = setup(() => allowed);
		mode.begin(1, 'tap');
		mode.cancel();
		expect(mode.active).toBe(false);
		expect(ran).toEqual([]);
		expect(said.at(-1)).toBe('Link cancelled.');
	});

	it('follows the pointer for the rubber band', () => {
		const { mode } = setup(() => allowed);
		mode.begin(0, 'drag', 10, 20);
		mode.point(30, 40);
		expect(mode.state).toMatchObject({ x: 30, y: 40 });
	});
});

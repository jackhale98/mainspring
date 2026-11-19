// SPDX-License-Identifier: GPL-2.0-or-later
// The Gantt's row commands as view planners (rows-plan.ts, ADR-0018 decision 3): steps on the tree
// of the text now, at the edges and past unresolved siblings, adds after an anchor or at the end,
// and a gone or changed anchor refused, never sent to the end of the plan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, type Harness } from '../state/edits-testing';
import type { ViewPlanned } from '../state/edits-types';
import { world } from '../state/rebase-testing';
import { ganttActionStrings as S, gestureStrings, refusalStrings } from '../strings';
import { addTaskPlan, stepTaskPlan } from './rows-plan';

const PLAN = [
	'project p "P" 2026-01-05 +1m',
	'macro tid [m1]',
	'task a "A"',
	'task ${tid} "Macro"',
	'task b "B"',
	'task g "G" {',
	'  task x "X"',
	'  task y "Y"',
	'}',
	'',
].join('\n');

const on = (text = PLAN) => {
	const w = world(text);
	return w.base(w.version());
};
const move = (task: string, parent: string | null, index: number): ViewPlanned => ({
	status: 'intent',
	intent: { type: 'moveTask', task, parent, index },
	label: { text: S.label.move(task.toUpperCase().slice(-1)), approx: false },
});

describe('stepTaskPlan', () => {
	it('moves one place, in and out, as stepTarget does on the fresh tree', () => {
		const base = on();
		expect(stepTaskPlan('b', 'up')(base)).toEqual(move('b', null, 0));
		expect(stepTaskPlan('a', 'down')(base)).toEqual(move('a', null, 1));
		expect(stepTaskPlan('b', 'indent')(base)).toEqual(move('b', 'a', 0));
		expect(stepTaskPlan('g.x', 'outdent')(base)).toEqual(move('g.x', null, 3));
		expect(stepTaskPlan('g.y', 'up')(base)).toEqual(move('g.y', 'g', 0));
	});

	it('counts past an unresolved sibling (the macro task has no id to name)', () => {
		// a, ${tid}, b, g: b is the second resolved root, so up puts it first.
		expect(stepTaskPlan('a', 'down')(on())).toEqual(move('a', null, 1));
		expect(stepTaskPlan('b', 'up')(on())).toEqual(move('b', null, 0));
	});

	it('answers unchanged with the view’s sentence at an edge', () => {
		const nowhere = { status: 'unchanged', message: gestureStrings.live.noPlace };
		expect(stepTaskPlan('a', 'up')(on())).toEqual(nowhere);
		expect(stepTaskPlan('g', 'down')(on())).toEqual(nowhere);
		expect(stepTaskPlan('a', 'outdent')(on())).toEqual(nowhere);
		expect(stepTaskPlan('g.x', 'indent')(on())).toEqual(nowhere);
	});

	it('refuses a task that is gone, or whose id now names another declaration', () => {
		expect(stepTaskPlan('zz', 'up')(on())).toEqual({
			status: 'not-possible',
			message: refusalStrings['unknown-target'],
			at: [],
		});
		const w = world(PLAN);
		const v0 = w.version();
		// Typed: a becomes c, then b becomes a.
		const a = w.text().indexOf('task a') + 5;
		w.type(a, a + 1, 'c');
		const b = w.text().indexOf('task b') + 5;
		w.type(b, b + 1, 'a');
		expect(stepTaskPlan('a', 'up')(w.base(v0))).toEqual({
			status: 'not-possible',
			message: refusalStrings['target-changed'],
			at: [],
		});
	});
});

describe('addTaskPlan', () => {
	const add = (parent: string | null, index: number): ViewPlanned => ({
		status: 'intent',
		intent: { type: 'addTask', parent, index, name: 'New' },
		label: { text: S.label.add('New'), approx: false },
	});

	it('adds after the anchor, as its last subtask, or at the end with no anchor', () => {
		expect(addTaskPlan('a', 'after', 'New')(on())).toEqual(add(null, 1));
		expect(addTaskPlan('g.x', 'after', 'New')(on())).toEqual(add('g', 1));
		expect(addTaskPlan('g', 'subtask', 'New')(on())).toEqual(add('g', 2));
		expect(addTaskPlan(null, 'after', 'New')(on())).toEqual(add(null, 3));
	});

	it('refuses a subtask with no task to put it under', () => {
		expect(addTaskPlan(null, 'subtask', 'New')(on())).toEqual({
			status: 'not-possible',
			message: gestureStrings.live.noAddPlace,
			at: [],
		});
	});

	it('refuses a gone anchor instead of adding at the end of the plan', () => {
		expect(addTaskPlan('gone', 'after', 'New')(on())).toEqual({
			status: 'not-possible',
			message: refusalStrings['unknown-target'],
			at: [],
		});
		const w = world(PLAN);
		const v0 = w.version();
		const a = w.text().indexOf('task a') + 5;
		w.type(a, a + 1, 'c');
		const b = w.text().indexOf('task b') + 5;
		w.type(b, b + 1, 'a');
		expect(addTaskPlan('a', 'subtask', 'New')(w.base(v0))).toMatchObject({
			status: 'not-possible',
			message: refusalStrings['target-changed'],
		});
	});
});

describe('through the dispatcher, while the published index lags', () => {
	let h: Harness;
	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		h = harness({
			entry: 'plan.tjp',
			files: {
				'plan.tjp':
					'project p "P" 2026-01-05 +1m\ntask a "A"\ntask b "B"\ntask c "C"\ntask d "D"\n',
			},
		});
		await h.finish();
	});
	afterEach(() => {
		h.dispose();
		vi.useRealTimers();
	});

	it('makes three quick presses three places, each planned on the text now', async () => {
		const shown = h.runner.state.indexVersion;
		for (let i = 0; i < 3; i++) {
			expect((await h.edits.dispatchPlan(stepTaskPlan('d', 'up'))).status).toBe('applied');
		}
		expect(h.runner.state.indexVersion).toBe(shown);
		expect(h.text()).toMatch(/task d "D"\ntask a "A"\ntask b "B"\ntask c "C"/);
		// A fourth finds no place on the text now, though the shown tree has one.
		await expect(h.edits.dispatchPlan(stepTaskPlan('d', 'up'))).resolves.toMatchObject({
			status: 'noop',
			message: gestureStrings.live.noPlace,
		});
	});
});

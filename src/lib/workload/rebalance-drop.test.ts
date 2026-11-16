// SPDX-License-Identifier: GPL-2.0-or-later
// The rebalance drag's drop rules (phase-3.md 7.2, 18.9): the axis lock, one action per drop, and
// "Move which task?". Property: whatever the pointer path, a drop gives at most one action, and
// it changes only the locked axis.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { availabilityOf } from './availability';
import { buildLoad } from './load';
import { planRebalance } from './rebalance';
import { dropAction, dropTask, lockAxis, type RebalanceAxis } from './rebalance-drop';
import { workloadPlan } from './rebalance-testing';
import type { CellTask } from './types';

const SLOP = 8;

/** The lock after a pointer path of (dx, dy) offsets from the drag's start. */
const follow = (path: ReadonlyArray<readonly [number, number]>): RebalanceAxis | null =>
	path.reduce<RebalanceAxis | null>((axis, [dx, dy]) => lockAxis(dx, dy, SLOP, axis), null);

describe('axis lock (7.2)', () => {
	it('stays unlocked within the slop', () => {
		expect(
			follow([
				[3, 2],
				[-8, 8],
				[0, -8],
			]),
		).toBeNull();
	});

	it('locks to the larger movement once past the slop', () => {
		expect(
			follow([
				[2, 1],
				[12, 3],
			]),
		).toBe('week');
		expect(
			follow([
				[1, 2],
				[3, 12],
			]),
		).toBe('person');
		expect(follow([[9, 9]])).toBe('week');
	});

	it('keeps the axis when the other movement grows larger', () => {
		expect(
			follow([
				[12, 0],
				[14, 80],
				[-40, 200],
			]),
		).toBe('week');
		expect(
			follow([
				[0, -12],
				[300, -14],
			]),
		).toBe('person');
	});

	it('unlocks over the origin, and locks afresh after it', () => {
		expect(
			follow([
				[12, 0],
				[2, 1],
			]),
		).toBeNull();
		expect(
			follow([
				[12, 0],
				[2, 1],
				[3, 30],
			]),
		).toBe('person');
		expect(
			follow([
				[0, 20],
				[0, -3],
				[-25, -4],
			]),
		).toBe('week');
	});
});

describe('one drop, one action (18.9)', () => {
	const origin = { resource: 'm1', bucket: 0 };
	const target = { resource: 'm3', bucket: 10080 };

	it('a person drop keeps the bucket; a week drop keeps the person', () => {
		expect(dropAction('t', origin, target, 'person')).toEqual({
			type: 'reassign',
			task: 't',
			from: 'm1',
			to: 'm3',
		});
		expect(dropAction('t', origin, target, 'week')).toEqual({
			type: 'shift',
			task: 't',
			fromBucket: 0,
			toBucket: 10080,
		});
		expect(dropAction('t', origin, target, null)).toBeNull();
	});

	it('never changes both, whatever the pointer path (property)', () => {
		const p = workloadPlan('groups');
		const people = ['m1', 'm2', 'm3', 'lead', 'team', 'leads'];
		const step = fc.tuple(fc.integer({ min: -200, max: 200 }), fc.integer({ min: -200, max: 200 }));
		fc.assert(
			fc.property(
				fc.array(step, { minLength: 1, maxLength: 12 }),
				fc.constantFrom(...people),
				fc.constantFrom(...people),
				fc.integer({ min: -3, max: 3 }),
				(path, from, to, weeks) => {
					const axis = follow(path);
					const a = dropAction(
						'work.t1',
						{ resource: from, bucket: 0 },
						{ resource: to, bucket: weeks * 10080 },
						axis,
					);
					if (axis === null) return a === null;
					if (!a) return false;
					const plan = planRebalance(a, p.at());
					// A reassign never moves in time, a shift never changes the person.
					if (a.type === 'reassign') {
						return (
							axis === 'person' &&
							(plan.status !== 'intent' || plan.intent.type === 'replaceAllocation')
						);
					}
					return axis === 'week' && plan.status !== 'intent';
				},
			),
			{ numRuns: 200 },
		);
	});
});

describe('Move which task? (18.9)', () => {
	const cell = (task: string, movable: boolean, kind: CellTask['kind'] = 'booked'): CellTask => ({
		task,
		minutes: 60,
		kind,
		movable,
	});

	it('drags the one movable task, asks between several, and has nothing on a group row', () => {
		expect(dropTask([cell('a', true), cell('b', false)])).toEqual({ kind: 'one', task: 'a' });
		expect(dropTask([cell('a', true), cell('b', true), cell('c', false, 'held')])).toEqual({
			kind: 'ask',
			tasks: ['a', 'b'],
		});
		expect(dropTask([cell('a', false), cell('b', false, 'unmet')])).toEqual({ kind: 'none' });
		expect(dropTask([])).toEqual({ kind: 'none' });
	});

	it('lists a task once', () => {
		expect(dropTask([cell('a', true), cell('a', true)])).toEqual({ kind: 'one', task: 'a' });
	});

	it('follows the load model: a group row has no movable task', () => {
		const p = workloadPlan('groups');
		const m = buildLoad({
			result: p.result,
			index: p.index,
			zones: p.at().zones!,
			kind: 'week',
			collapsed: new Set(),
			availability: availabilityOf(p.result, 'plan'),
			demand: null,
		});
		const team = m.rows.findIndex((r) => r.id === 'team');
		const m1 = m.rows.findIndex((r) => r.id === 'm1');
		expect(dropTask(m.cellTasks(team, 0))).toEqual({ kind: 'none' });
		expect(m.cellTasks(team, 0).length).toBeGreaterThan(1);
		expect(dropTask(m.cellTasks(m1, 0))).toEqual({ kind: 'one', task: 'work.t1' });
	});
});

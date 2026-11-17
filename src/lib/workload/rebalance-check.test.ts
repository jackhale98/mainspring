// SPDX-License-Identifier: GPL-2.0-or-later
// The rebalance dry run (rebalance-check.ts): every kind of outcome reaches the caller with its
// reason and one sentence, whichever side decided it: the planner's (each `RebalanceRefusal`,
// `via-group` naming the group, `no-working-day` naming the zoom), the Gantt's for a week move
// (`ask-move-preference`, `container`), the edit API's (`unsupported-form`, noop), and an edit
// that keeps the rebalance label. The bucket length decides the zoom word.
import { describe, expect, it } from 'vitest';
import { DAY } from '../schedule/testing';
import { bucketUnit, checkRebalance, rebalanceMessage } from './rebalance-check';
import { reproPlan, workloadPlan } from './rebalance-testing';

const WEEK = 7 * DAY;

describe('checkRebalance', () => {
	const groups = workloadPlan('groups');

	it('gives the edit with the rebalance label, and the planned intent', () => {
		const out = checkRebalance(
			{ type: 'reassign', task: 'work.t4', from: 'lead', to: 'm1' },
			groups.at(),
			groups.snap,
		);
		expect(out).toMatchObject({
			status: 'edit',
			intent: { type: 'replaceAllocation', task: 'work.t4', from: 'lead', to: 'm1' },
			label: { text: 'Moved Lead work from Lead to M1' },
			constraint: false,
		});
	});

	it('gives the planner’s refusals with their sentences, before any edit', () => {
		const g = workloadPlan('group-allocation');
		const cases = [
			[
				groups,
				{ type: 'reassign', task: 'work.t1', from: 'm1', to: 'm1' },
				'The task is already there.',
			],
			[
				groups,
				{ type: 'reassign', task: 'work.t1', from: 'm1', to: 'team' },
				'Work moves to a person, not to a group.',
			],
			[
				g,
				{ type: 'reassign', task: 'work.other', from: 'm1', to: 'm2' },
				'This person does not work on this task.',
			],
			[
				g,
				{ type: 'reassign', task: 'work.triage', from: 'm2', to: 'solo' },
				"Booked through Team. Change the task's people in its details.",
			],
		] as const;
		for (const [p, a, message] of cases) {
			expect(checkRebalance(a, p.at(), p.snap)).toMatchObject({
				status: 'refused',
				intent: null,
				message,
			});
		}
	});

	it('names the zoom when the target bucket has no working day', () => {
		const p = reproPlan();
		const week = {
			type: 'shift',
			task: 'off',
			fromBucket: 3 * WEEK,
			toBucket: 4 * WEEK,
			toBucketEnd: 5 * WEEK,
		} as const;
		expect(checkRebalance(week, p.at(), p.snap)).toMatchObject({
			reason: 'no-working-day',
			message: 'No working days in that week.',
		});
		const day = {
			...week,
			task: 'mon',
			fromBucket: 7 * DAY,
			toBucket: 6 * DAY,
			toBucketEnd: 7 * DAY,
		};
		expect(checkRebalance(day, p.at(), p.snap)).toMatchObject({
			message: 'No working time on that day.',
		});
		expect(
			rebalanceMessage({ status: 'not-possible', reason: 'no-working-day', at: [] }, p.at(), {
				...week,
				toBucket: 0,
				toBucketEnd: 31 * DAY,
			}),
		).toBe('No working days in that month.');
	});

	it('passes the Gantt’s answers and the edit API’s refusals through', () => {
		const move = {
			type: 'shift',
			task: 'work.t1',
			fromBucket: 0,
			toBucket: WEEK,
			toBucketEnd: 2 * WEEK,
		} as const;
		expect(checkRebalance(move, groups.at({ move: null }), groups.snap)).toEqual({
			status: 'ask-move-preference',
			suggested: 'start',
		});
		expect(checkRebalance(move, groups.at(), groups.snap)).toMatchObject({
			status: 'edit',
			intent: { type: 'setAttr', attr: 'start' },
		});
		expect(checkRebalance({ ...move, task: 'work' }, groups.at(), groups.snap)).toMatchObject({
			status: 'refused',
			reason: 'container',
		});
		const alt = workloadPlan('alternatives');
		expect(
			checkRebalance(
				{ type: 'reassign', task: 'work.fix', from: 'bo', to: 'cy' },
				alt.at(),
				alt.snap,
			),
		).toMatchObject({
			status: 'refused',
			intent: { type: 'replaceAllocation' },
			reason: 'unsupported-form',
		});
		expect(
			checkRebalance(
				{ type: 'reassign', task: 'work.t1', from: 'm1', to: 'nobody' },
				groups.at(),
				groups.snap,
			),
		).toMatchObject({
			status: 'refused',
			reason: 'unknown-target',
		});
	});
});

describe('bucketUnit', () => {
	it('tells days (23 to 25 h), weeks (167 to 169 h) and months apart', () => {
		expect([23 * 60, DAY, 25 * 60].map(bucketUnit)).toEqual(['day', 'day', 'day']);
		expect([WEEK - 60, WEEK, WEEK + 60].map(bucketUnit)).toEqual(['week', 'week', 'week']);
		expect([28 * DAY, 31 * DAY - 60].map(bucketUnit)).toEqual(['month', 'month']);
	});
});

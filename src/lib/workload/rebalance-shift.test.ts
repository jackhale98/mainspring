// SPDX-License-Identifier: GPL-2.0-or-later
// The rebalance planner's week moves (phase-3.md 6.6, 7.1 W2, 13.1, 18.9): `shift` becomes the
// Gantt's `move` action with the working days between the buckets counted from the task (T12),
// planned by `planAction`, so the move preference and ALAP apply as in R2; the DST weeks of
// Europe/Berlin; and the counting itself against a working time with holidays. The person moves
// (W1) are in rebalance.test.ts.
import { describe, expect, it } from 'vitest';
import { planAction } from '../gantt/intents';
import { at, DAY } from '../schedule/testing';
import { workingTimeFromPairs } from '../schedule/working-time';
import { bucketAxis } from './axis';
import {
	planRebalance,
	shiftDaysOf,
	workingDaysBetween,
	type RebalanceAction,
	type RebalancePlan,
} from './rebalance';
import { checkRebalance } from './rebalance-check';
import {
	INLINE_TEXT,
	inlinePlan,
	textAfter,
	withTask,
	workloadPlan,
	ZONES,
} from './rebalance-testing';

const refusal = (p: RebalancePlan) => (p.status === 'not-possible' ? p.reason : p.status);

describe('shift (W2)', () => {
	const WEEK = 7 * DAY;

	it('refuses a drop on its own column: same-place', () => {
		const p = workloadPlan('groups');
		expect(
			planRebalance({ type: 'shift', task: 'work.t1', fromBucket: 0, toBucket: 0 }, p.at()),
		).toEqual({ status: 'not-possible', reason: 'same-place', at: [] });
	});

	it('moves an ASAP task by the working days between the weeks, as R2 with start', () => {
		const p = workloadPlan('groups');
		const a: RebalanceAction = { type: 'shift', task: 'work.t1', fromBucket: 0, toBucket: WEEK };
		const plan = planRebalance(a, p.at());
		expect(plan).toEqual({ status: 'action', action: { type: 'move', task: 'work.t1', days: 5 } });
		if (plan.status !== 'action') throw new Error('action');
		expect(planAction(plan.action, p.at())).toMatchObject({
			status: 'intent',
			intent: { type: 'setAttr', task: 'work.t1', attr: 'start', value: '2026-01-12' },
		});
		const back = planRebalance(
			{ type: 'shift', task: 'work.t4', fromBucket: WEEK, toBucket: 0 },
			p.at(),
		);
		expect(back).toEqual({ status: 'action', action: { type: 'move', task: 'work.t4', days: -5 } });
	});

	it('asks for the move preference when there is none, as R2 does', () => {
		const p = workloadPlan('groups');
		const plan = planRebalance(
			{ type: 'shift', task: 'work.t1', fromBucket: 0, toBucket: WEEK },
			p.at(),
		);
		if (plan.status !== 'action') throw new Error('action');
		expect(planAction(plan.action, p.at({ move: null })).status).toBe('ask-move-preference');
		expect(
			checkRebalance(
				{ type: 'shift', task: 'work.t1', fromBucket: 0, toBucket: WEEK },
				p.at({ move: null }),
				p.snap,
			).status,
		).toBe('ask-move-preference');
	});

	it('moves an ALAP task by its end: setAttr end, whatever the preference', () => {
		const p = inlinePlan();
		const a: RebalanceAction = {
			type: 'shift',
			task: 'late',
			fromBucket: WEEK,
			toBucket: 2 * WEEK,
		};
		const plan = planRebalance(a, p.at());
		expect(plan).toEqual({ status: 'action', action: { type: 'move', task: 'late', days: 5 } });
		if (plan.status !== 'action') throw new Error('action');
		for (const kind of ['start', 'gap'] as const) {
			expect(planAction(plan.action, p.at({ move: { kind } }))).toMatchObject({
				status: 'intent',
				intent: { type: 'setAttr', task: 'late', attr: 'end', value: '2026-01-23' },
			});
		}
		const out = checkRebalance(a, p.at(), p.snap);
		if (out.status !== 'edit') throw new Error(out.status);
		expect(textAfter(p.snap, out.edit.changes, 'plan.tjp')).toBe(
			INLINE_TEXT.replace('end 2026-01-16', 'end 2026-01-23'),
		);
	});

	it('keeps the weekday across a holiday in either week (counts from the task, T12)', () => {
		// Mon-Fri 9-17 for six weeks, with Monday of week 2 (day 7) a holiday.
		const pairs = Array.from({ length: 42 }, (_, d) => d)
			.filter((d) => d % 7 < 5 && d !== 7)
			.map((d) => [at(d, 9), at(d, 17)] as [number, number]);
		const wt = workingTimeFromPairs(pairs, { resolution: 60, frameEnd: 42 * DAY });
		// From Wednesday of week 1 to week 2: four working days, so Wednesday again.
		expect(workingDaysBetween(wt, at(2, 9), at(9, 9))).toBe(4);
		expect(wt.shiftDays(at(2, 9), 4, 'start')).toBe(at(9, 9));
		// The bucket starts would count five, landing on Thursday.
		expect(workingDaysBetween(wt, 0, WEEK)).toBe(5);
		// Back from Wednesday of week 2 to week 1, and onto a holiday: the next working day.
		expect(workingDaysBetween(wt, at(9, 9), at(2, 9))).toBe(-4);
		expect(workingDaysBetween(wt, at(0, 9), at(7, 9))).toBe(5);
		expect(wt.shiftDays(at(0, 9), 5, 'start')).toBe(at(8, 9));
		// Past the last working day: as far as the days go.
		expect(workingDaysBetween(wt, at(38, 9), at(60, 9))).toBe(1);
	});

	it('counts the bucket starts for a task without dates (6.6)', () => {
		const p = workloadPlan('groups');
		const r = withTask(p.result, 'work.t1', { start: null, end: null, scheduled: false });
		const a: RebalanceAction = {
			type: 'shift',
			task: 'work.t1',
			fromBucket: 0,
			toBucket: 2 * WEEK,
		};
		expect(shiftDaysOf(a, p.at({ result: r }))).toBe(10);
		expect(shiftDaysOf(a, p.at({ wt: null }))).toBe(14);
	});

	it('refuses two buckets with no working day between them: same-place', () => {
		const p = workloadPlan('groups');
		// Saturday to Sunday of the first week, in day buckets.
		const plan = planRebalance(
			{ type: 'shift', task: 'work.t1', fromBucket: 5 * DAY, toBucket: 6 * DAY },
			p.at({ result: withTask(p.result, 'work.t1', { start: null, end: null }) }),
		);
		expect(refusal(plan)).toBe('same-place');
	});

	it('follows the local week across a DST change (Europe/Berlin)', () => {
		const p = workloadPlan('dst-weeks');
		const project = p.result.project!;
		expect(project.timezone).toBe('Europe/Berlin');
		// The spring task starts Monday 2026-03-23 09:00 local; the next local week starts 167 h
		// after that week's start (the clock goes forward on the 29th).
		const weeks = bucketAxis(project, ZONES, 'week').bounds;
		expect((weeks[1] as number) - (weeks[0] as number)).toBe(7 * DAY - 60);
		const a: RebalanceAction = {
			type: 'shift',
			task: 'spring',
			fromBucket: weeks[0] as number,
			toBucket: weeks[1] as number,
		};
		const plan = planRebalance(a, p.at());
		expect(plan).toEqual({ status: 'action', action: { type: 'move', task: 'spring', days: 5 } });
		if (plan.status !== 'action') throw new Error('action');
		expect(planAction(plan.action, p.at())).toMatchObject({
			intent: { type: 'setAttr', task: 'spring', attr: 'start', value: '2026-03-30' },
		});
		// Autumn: the week of the 25th is 169 h long, and the move still lands on Monday.
		const autumn = 'autumn';
		const k =
			weeks.findIndex(
				(b) => b > (p.result.tasks.find((t) => t.id === autumn)?.scenarios['plan']?.start ?? 0),
			) - 1;
		const back = planRebalance(
			{
				type: 'shift',
				task: autumn,
				fromBucket: weeks[k] as number,
				toBucket: weeks[k + 1] as number,
			},
			p.at(),
		);
		if (back.status !== 'action') throw new Error('action');
		expect(planAction(back.action, p.at())).toMatchObject({
			intent: { type: 'setAttr', task: autumn, attr: 'start', value: '2026-10-26' },
		});
	});

	it('leaves unknown and text-only tasks to planAction', () => {
		const p = workloadPlan('groups');
		const plan = planRebalance(
			{ type: 'shift', task: 'nope', fromBucket: 0, toBucket: WEEK },
			p.at(),
		);
		if (plan.status !== 'action') throw new Error('action');
		expect(planAction(plan.action, p.at())).toMatchObject({ reason: 'unknown-target' });
		expect(
			checkRebalance(
				{ type: 'shift', task: 'work', fromBucket: 0, toBucket: WEEK },
				p.at(),
				p.snap,
			),
		).toMatchObject({ status: 'refused', reason: 'container' });
	});
});

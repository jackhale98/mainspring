// SPDX-License-Identifier: GPL-2.0-or-later
// The rebalance planner's week moves (phase-3.md 6.6, 7.1 W2, 13.1, 18.9): `shift` becomes the
// Gantt's `move` action, planned by `planAction`, so the move preference and ALAP apply as in R2.
// The work lands inside the target bucket (T12 review ruling): the task's weekday when it is a
// working day there, else the nearest working day inside, forward first, then backward; a bucket
// with no working day is `no-working-day`. Each review repro is here (week, month and day zoom),
// with the DST weeks of Europe/Berlin and the counting itself. The engine half is in
// rebalance.engine.test.ts; the person moves (W1) are in rebalance.test.ts.
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
	reproPlan,
	textAfter,
	withTask,
	workloadPlan,
	ZONES,
	type Plan,
} from './rebalance-testing';

const WEEK = 7 * DAY;
const refusal = (p: RebalancePlan) => (p.status === 'not-possible' ? p.reason : p.status);

/** A shift between buckets of `size` minutes starting at `from` and `to`. */
const shift = (
	task: string,
	from: number,
	to: number,
	size = WEEK,
): Extract<RebalanceAction, { type: 'shift' }> => ({
	type: 'shift',
	task,
	fromBucket: from,
	toBucket: to,
	toBucketEnd: to + size,
});

/** What `planAction` writes for the planned move (its intent's value), or the refusal. */
function written(p: Plan, a: RebalanceAction, move: 'start' | 'gap' = 'start'): string {
	const plan = planRebalance(a, p.at());
	if (plan.status === 'not-possible') return plan.reason;
	if (plan.status !== 'action') throw new Error(plan.status);
	const out = planAction(plan.action, p.at({ move: { kind: move } }));
	if (out.status !== 'intent' || out.intent.type !== 'setAttr') return out.status;
	return `${out.intent.attr} ${String(out.intent.value)}`;
}

describe('shift (W2)', () => {
	it('refuses a drop on its own column: same-place', () => {
		const p = workloadPlan('groups');
		expect(planRebalance(shift('work.t1', 0, 0), p.at())).toEqual({
			status: 'not-possible',
			reason: 'same-place',
			at: [],
		});
	});

	it('moves an ASAP task by the working days between the weeks, as R2 with start', () => {
		const p = workloadPlan('groups');
		const plan = planRebalance(shift('work.t1', 0, WEEK), p.at());
		expect(plan).toEqual({ status: 'action', action: { type: 'move', task: 'work.t1', days: 5 } });
		expect(written(p, shift('work.t1', 0, WEEK))).toBe('start 2026-01-12');
		expect(planRebalance(shift('work.t4', WEEK, 0), p.at())).toEqual({
			status: 'action',
			action: { type: 'move', task: 'work.t4', days: -5 },
		});
	});

	it('asks for the move preference when there is none, as R2 does', () => {
		const p = workloadPlan('groups');
		const a = shift('work.t1', 0, WEEK);
		const plan = planRebalance(a, p.at());
		if (plan.status !== 'action') throw new Error('action');
		expect(planAction(plan.action, p.at({ move: null })).status).toBe('ask-move-preference');
		expect(checkRebalance(a, p.at({ move: null }), p.snap).status).toBe('ask-move-preference');
	});

	it('moves an ALAP task by its end: setAttr end, whatever the preference', () => {
		const p = inlinePlan();
		const a = shift('late', WEEK, 2 * WEEK);
		expect(planRebalance(a, p.at())).toEqual({
			status: 'action',
			action: { type: 'move', task: 'late', days: 5 },
		});
		for (const kind of ['start', 'gap'] as const) {
			expect(written(p, a, kind)).toBe('end 2026-01-23');
		}
		const out = checkRebalance(a, p.at(), p.snap);
		if (out.status !== 'edit') throw new Error(out.status);
		expect(textAfter(p.snap, out.edit.changes, 'plan.tjp')).toBe(
			INLINE_TEXT.replace('end 2026-01-16', 'end 2026-01-23'),
		);
	});

	it('follows the local week across a DST change (Europe/Berlin)', () => {
		const p = workloadPlan('dst-weeks');
		const weeks = bucketAxis(p.result.project!, ZONES, 'week').bounds;
		const b = (i: number) => weeks[i] as number;
		// The clock goes forward on the 29th: that week is 167 h.
		expect(b(1) - b(0)).toBe(7 * DAY - 60);
		const spring = { ...shift('spring', b(0), b(1)), toBucketEnd: b(2) };
		expect(planRebalance(spring, p.at())).toMatchObject({ action: { days: 5 } });
		expect(written(p, spring)).toBe('start 2026-03-30');
		// Autumn: the week of the 25th is 169 h, and the move still lands on Monday.
		const start = p.result.tasks.find((t) => t.id === 'autumn')?.scenarios['plan']?.start ?? 0;
		const k = weeks.findIndex((x) => x > start) - 1;
		const autumn = { ...shift('autumn', b(k), b(k + 1)), toBucketEnd: b(k + 2) };
		expect(written(p, autumn)).toBe('start 2026-10-26');
	});

	it('leaves unknown tasks and containers to planAction', () => {
		const p = workloadPlan('groups');
		const plan = planRebalance(shift('nope', 0, WEEK), p.at());
		if (plan.status !== 'action') throw new Error('action');
		expect(planAction(plan.action, p.at())).toMatchObject({ reason: 'unknown-target' });
		expect(checkRebalance(shift('work', 0, WEEK), p.at(), p.snap)).toMatchObject({
			status: 'refused',
			reason: 'container',
		});
	});
});

// Day 0 is Monday 2026-01-05; weeks start at multiples of WEEK (UTC plans).
describe('inside the target bucket (T12 review repros)', () => {
	const p = reproPlan();

	it('a Friday holiday in the target week: the nearest working day inside, backward', () => {
		// `fri` is on Friday 16 January; Friday 23 is a holiday, so Thursday 22, not Monday 26.
		expect(written(p, shift('fri', WEEK, 2 * WEEK))).toBe('start 2026-01-22');
		// Back from that week the weekday is a working day again.
		expect(written(p, shift('fri', WEEK, 0))).toBe('start 2026-01-09');
	});

	it('an ALAP move puts the end inside the target week', () => {
		// `alap` ends Friday 30 January; a week earlier is the holiday Friday 23, so Thursday 22.
		expect(written(p, shift('alap', 3 * WEEK, 2 * WEEK))).toBe('end 2026-01-23');
		expect(written(p, shift('alap', 3 * WEEK, 2 * WEEK), 'gap')).toBe('end 2026-01-23');
	});

	it('a target week that is all holiday is refused: no-working-day', () => {
		const a = shift('off', 3 * WEEK, 4 * WEEK);
		expect(refusal(planRebalance(a, p.at()))).toBe('no-working-day');
		expect(checkRebalance(a, p.at(), p.snap)).toMatchObject({
			status: 'refused',
			intent: null,
			reason: 'no-working-day',
			message: 'No working days in that week.',
		});
		// The week after it is fine.
		expect(written(p, shift('off', 3 * WEEK, 5 * WEEK))).toBe('start 2026-02-11');
	});

	it('month zoom: a late-January task dropped on February stays in February', () => {
		const months = bucketAxis(p.result.project!, ZONES, 'month').bounds;
		const a: RebalanceAction = {
			type: 'shift',
			task: 'jan29',
			fromBucket: months[0] as number,
			toBucket: months[1] as number,
			toBucketEnd: months[2] as number,
		};
		// 29 January plus January's 31 days is 1 March, past February: its last working day.
		expect(written(p, a)).toBe('start 2026-02-27');
		const back: RebalanceAction = {
			type: 'shift',
			task: 'jan29',
			fromBucket: months[0] as number,
			toBucket: months[0] as number,
			toBucketEnd: months[1] as number,
		};
		expect(refusal(planRebalance(back, p.at()))).toBe('same-place');
	});

	it('day zoom: a drop on a Sunday or a holiday is refused, not moved to Monday', () => {
		const sunday = shift('mon', 7 * DAY, 6 * DAY, DAY);
		expect(refusal(planRebalance(sunday, p.at()))).toBe('no-working-day');
		expect(checkRebalance(sunday, p.at(), p.snap)).toMatchObject({
			message: 'No working time on that day.',
		});
		expect(refusal(planRebalance(shift('mon', 7 * DAY, 16 * DAY, DAY), p.at()))).toBe(
			'no-working-day',
		);
		expect(written(p, shift('mon', 7 * DAY, 4 * DAY, DAY))).toBe('start 2026-01-09');
	});

	it('a long task dragged by a later week moves that part by the week', () => {
		// `long` runs 5 to 16 January; its second week (12 to 16) dragged one week on.
		// Monday 12 (the part in the dragged week) lands on Monday 19: five working days, so the
		// task starts a week later, not two (its own start, the 5th, is outside the dragged week).
		expect(planRebalance(shift('long', WEEK, 2 * WEEK), p.at())).toMatchObject({
			action: { days: 5 },
		});
		expect(written(p, shift('long', WEEK, 2 * WEEK))).toBe('start 2026-01-12');
	});
});

describe('counting working days', () => {
	it('counts from the task and walks to the target day', () => {
		// Mon-Fri 9-17 for six weeks, with Monday of week 2 (day 7) a holiday.
		const pairs = Array.from({ length: 42 }, (_, d) => d)
			.filter((d) => d % 7 < 5 && d !== 7)
			.map((d) => [at(d, 9), at(d, 17)] as [number, number]);
		const wt = workingTimeFromPairs(pairs, { resolution: 60, frameEnd: 42 * DAY });
		expect(workingDaysBetween(wt, at(2, 9), at(9, 9))).toBe(4);
		expect(wt.shiftDays(at(2, 9), 4, 'start')).toBe(at(9, 9));
		expect(workingDaysBetween(wt, 0, WEEK)).toBe(5);
		expect(workingDaysBetween(wt, at(9, 9), at(2, 9))).toBe(-4);
		expect(workingDaysBetween(wt, at(38, 9), at(60, 9))).toBe(1);
	});

	it('anchors a task without dates on the origin bucket (6.6), and has no wt fallback days', () => {
		const p = workloadPlan('groups');
		const r = withTask(p.result, 'work.t1', { start: null, end: null, scheduled: false });
		const a = shift('work.t1', 0, 2 * WEEK);
		expect(shiftDaysOf(a, p.at({ result: r }))).toBe(10);
		expect(shiftDaysOf(a, p.at({ wt: null }))).toBe(14);
		// Saturday to Sunday in day buckets: no working day there.
		expect(
			refusal(planRebalance(shift('work.t1', 5 * DAY, 6 * DAY, DAY), p.at({ result: r }))),
		).toBe('no-working-day');
	});
});

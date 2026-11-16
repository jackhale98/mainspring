// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the leave-paint planner: minutes of the UTC fixtures' days, strokes, the
 * planner's context, the entry's text after the planned intent (the edit API's dry run), and a
 * one-person inline plan with a hand-made result.
 */
import type { Planned } from '../gantt/intents';
import { plan as resultOf } from '../schedule/testing';
import { applyIntent } from '../tjp/edit/apply';
import { textsAfter } from '../tjp/edit/testing';
import type { LeaveType } from '../tjp/edit/types';
import { planFrom, ZONES, type Plan } from '../workload/rebalance-testing';
import { resourceResult, withPeople } from '../workload/testing';
import type { LeavePaint, LeavePaintContext, PaintScope } from './paint';

export const DAY = 1440;
/** Minutes of local midnight `d` days after the 2026-01-05 start (UTC plans). */
export const day = (d: number): number => d * DAY;

export const ctxOf = (p: Plan): LeavePaintContext => ({
	index: p.index,
	result: p.result,
	zones: ZONES,
});

/** The entry's text after the planned intent, or the edit API's answer when it gives no edit. */
export function after(p: Plan, planned: Planned): string | { status: string; reason?: string } {
	if (planned.status !== 'intent') throw new Error(`planned ${planned.status}`);
	const r = applyIntent(p.snap, p.index, planned.intent);
	if (r.status !== 'edit') return { status: r.status, reason: r.reason };
	return textsAfter(p.snap, r)[p.snap.entry] as string;
}

export const person = (resource: string): PaintScope => ({ kind: 'resource', resource });
export const paint = (
	scope: PaintScope,
	from: number,
	to: number,
	leave: LeaveType,
	name?: string,
): LeavePaint => ({
	type: 'paint',
	scope,
	from,
	to,
	leave,
	...(name === undefined ? {} : { name }),
});

/** A one-person plan with `leave` in dev's body; a hand-made result with the default calendar. */
export function onePerson(leave: string, extra = ''): Plan {
	const text = `project p "P" 2026-01-05 - 2026-03-02 {\n}\n${extra}resource dev "Dev" {\n  ${leave}\n}\ntask t "T" {\n  effort 3d\n  allocate dev\n}\n`;
	const r = withPeople(resultOf([['t', { start: 540, end: 2460 }]]), [resourceResult('dev')], []);
	return planFrom({ 'plan.tjp': text }, 'plan.tjp', r);
}

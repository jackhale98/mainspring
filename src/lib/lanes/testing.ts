// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Builders for the lanes' tests: a lanes model from the workload tests' inline plan (Ann, Bo in
 * Team, Cy; rebalance-testing.ts) with one slot of booked time per working day and two days of
 * annual leave for Cy, without an engine.
 */
import { createTimeZoneHost } from '../../engine/timezone';
import { at } from '../schedule/testing';
import { availabilityOf } from '../workload/availability';
import { buildLoad } from '../workload/load';
import { INLINE_TEXT, inlinePlan, planFrom } from '../workload/rebalance-testing';
import { booking, resourceResult, withPeople } from '../workload/testing';
import type { BucketKind } from '../workload/types';
import { buildLanes, type LanesModel } from './lane-model';

export const ZONES = createTimeZoneHost();

/** One slot per working day, as the engine sends bookings. */
export const slots = (days: number[]): Array<[number, number]> =>
	days.map((d): [number, number] => [at(d, 9), at(d, 17)]);

export const BOOKINGS = [
	booking('a', 'pair', slots([2, 3])),
	booking('c', 'pair', slots([2, 3])),
	booking('a', 'parent.child', slots([0, 1])),
	booking('c', 'late', slots([9, 10])),
];

/** The lanes model of the inline plan; `text` is its source (a macro makes a task text-only). */
export function lanesOf(
	text = INLINE_TEXT,
	kind: BucketKind = 'week',
	taskSource?: { task: string; line: number },
): LanesModel {
	const base = inlinePlan();
	const leave: Array<[number, number]> = [
		[at(14, 9), at(14, 17)],
		[at(15, 9), at(15, 17)],
	];
	let result = withPeople(
		base.result,
		[
			resourceResult('a'),
			resourceResult('team', { group: true }),
			resourceResult('b', { parent: 'team' }),
			resourceResult('c', { leaves: [{ type: 'annual', intervals: leave }] }),
		],
		BOOKINGS,
	);
	if (taskSource) {
		const { task, line } = taskSource;
		result = {
			...result,
			tasks: result.tasks.map((t) =>
				t.id === task ? { ...t, source: { file: 'plan.tjp', line, column: null } } : t,
			),
		};
	}
	const p = planFrom({ 'plan.tjp': text }, 'plan.tjp', result);
	const availability = availabilityOf(result, 'plan');
	const load = buildLoad({
		result,
		index: p.index,
		zones: ZONES,
		kind,
		collapsed: new Set(),
		availability,
		demand: null,
	});
	const project = result.project;
	if (!project) throw new Error('no project');
	return buildLanes({ load, availability, result, project, index: p.index, zones: ZONES });
}

export const rowOf = (l: LanesModel, id: string): number =>
	l.load.rows.findIndex((r) => r.id === id);

/** The inline plan's text with its `late` task written inside a macro: text-only. */
export function macroText(): { text: string; line: number } {
	const body = INLINE_TEXT.slice(INLINE_TEXT.indexOf('task late'));
	const text = `${INLINE_TEXT.replace(body, '')}macro mk [\n${body}]\n\${mk}\n`;
	return { text, line: text.split('\n').indexOf('${mk}') + 1 };
}

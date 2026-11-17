// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the rebalance planner: the workload fixtures (tests/fixtures/workload) with
 * their committed golden results, as `ActionContext`s with the zone data the app has, and inline
 * plans with hand-made results (schedule/testing.ts) for the cases no fixture holds.
 */
import type { ChangeSet } from '@codemirror/state';
import type { ScheduleResult, TaskScenarioResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import type { ActionContext } from '../gantt/intents';
import { fixtureFrom, goldenResult, type Fixture } from '../gantt/intents-testing';
import { workingTimeOf } from '../schedule/working-time';
import { buildIndex, hintsFromResult, type SymbolIndex } from '../tjp/index';
import { golden } from '../tjp/index/testing';
import { at, plan as resultOf } from '../schedule/testing';
import type { WorkspaceSnapshot } from '../workspace/workspace';
import { availabilityOf } from './availability';
import { buildLoad } from './load';
import { booking, resourceResult, withPeople } from './testing';
import type { BucketKind, LoadModel } from './types';

export const ZONES = createTimeZoneHost();

export interface Plan extends Fixture {
	/** The context with the zone data, working time and the move preference given. */
	at(over?: Partial<ActionContext>): ActionContext;
}

/** A plan from its files and a result, indexed with the engine's hints and the zone data. */
export function planFrom(
	files: Record<string, string>,
	entry: string,
	result: ScheduleResult,
): Plan {
	const fx = fixtureFrom(files, entry, result);
	const index = buildIndex(
		fx.snap,
		hintsFromResult(result, (_f, l) => l),
		{ cache: null, zones: ZONES },
	);
	const wt = result.project ? workingTimeOf(result.project, ZONES) : null;
	const at = (over: Partial<ActionContext> = {}): ActionContext => ({
		...fx.ctx(),
		index,
		wt,
		zones: ZONES,
		move: { kind: 'start' },
		...over,
	});
	return { ...fx, index, ctx: at, at };
}

/** A workload fixture (`workload-<name>`) with its golden result. */
export function workloadPlan(name: string): Plan {
	const id = `workload-${name}`;
	const ws = golden(id).snapshot();
	const files: Record<string, string> = {};
	for (const [p, f] of ws.files) files[p] = f.text.toString();
	return planFrom(files, ws.entry, goldenResult(id));
}

/** `result` with these scenario fields set on a task ('plan' scenario). */
export function withTask(
	result: ScheduleResult,
	id: string,
	over: Partial<TaskScenarioResult>,
): ScheduleResult {
	return {
		...result,
		tasks: result.tasks.map((t) =>
			t.id === id
				? {
						...t,
						scenarios: {
							...t.scenarios,
							plan: { ...t.scenarios['plan'], ...over } as TaskScenarioResult,
						},
					}
				: t,
		),
	};
}

/** Every file after applying an edit's changes (unchanged files as they were). */
export function textAfter(
	snap: WorkspaceSnapshot,
	changes: Readonly<Record<string, ChangeSet>>,
	file: string,
): string {
	const f = snap.files.get(file);
	if (!f) throw new Error(`no file ${file}`);
	const cs = changes[file];
	return cs ? cs.apply(f.text).toString() : f.text.toString();
}

/** Every file of the snapshot after the changes. */
export function filesAfter(
	snap: WorkspaceSnapshot,
	changes: Readonly<Record<string, ChangeSet>>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const path of snap.files.keys()) out[path] = textAfter(snap, changes, path);
	return out;
}

/** The load model of a result at a zoom, as the People views build it (no demand). */
export function loadOf(
	result: ScheduleResult,
	index: SymbolIndex,
	kind: BucketKind = 'week',
): LoadModel {
	const scenario = result.project?.scenarios.find((s) => s.active)?.id ?? 'plan';
	return buildLoad({
		result,
		index,
		zones: ZONES,
		kind,
		collapsed: new Set(),
		availability: availabilityOf(result, scenario),
		demand: null,
	});
}

/** One series of a person's row in the bucket that holds `at`. */
export function cell(
	m: LoadModel,
	resource: string,
	at: number,
	series: 'booked' | 'available' | 'leave' = 'booked',
): number {
	const row = m.rows.findIndex((r) => r.id === resource);
	const col = m.axis.indexOf(at);
	if (row < 0 || col < 0) throw new Error(`no cell ${resource} at ${at}`);
	return m[series][row]?.[col] as number;
}

/** The tasks booked on a person in the bucket that holds `at`. */
export function bookedTasks(m: LoadModel, resource: string, at: number): string[] {
	const row = m.rows.findIndex((r) => r.id === resource);
	return m
		.cellTasks(row, m.axis.indexOf(at))
		.filter((t) => t.kind === 'booked')
		.map((t) => t.task);
}

/** Inline plan: a, b (team), c, with tasks over the first weeks of 2026 (hand-made result). */
export const INLINE_TEXT = `project p "P" 2026-01-05 - 2026-03-02 {
}
resource a "Ann"
resource team "Team" {
  resource b "Bo"
}
resource c "Cy"
task pair "Pair" {
  start 2026-01-07
  effort 4d
  allocate a, c
}
task parent "Parent" {
  allocate a
  task child "Child" {
    start 2026-01-05
    effort 2d
  }
}
task late "Late" {
  end 2026-01-16
  scheduling alap
  effort 2d
  allocate c
}
`;

export function inlinePlan(): Plan {
	let r = resultOf([
		['pair', { start: at(2, 9), end: at(3, 17) }],
		['parent', { start: at(0, 9), end: at(1, 17) }],
		['parent.child', { start: at(0, 9), end: at(1, 17), parent: 'parent' }],
		['late', { start: at(9, 9), end: at(10, 17), alap: true }],
	]);
	r = withPeople(
		r,
		[
			resourceResult('a'),
			resourceResult('team', { group: true }),
			resourceResult('b', { parent: 'team' }),
			resourceResult('c'),
		],
		[
			booking('a', 'pair', [[at(2, 9), at(3, 17)]]),
			booking('c', 'pair', [[at(2, 9), at(3, 17)]]),
			booking('a', 'parent.child', [[at(0, 9), at(1, 17)]]),
			booking('c', 'late', [[at(9, 9), at(10, 17)]]),
		],
	);
	r = withTask(r, 'pair', { allocate: [{ candidates: ['a'] }, { candidates: ['c'] }] });
	r = withTask(r, 'parent', { allocate: [{ candidates: ['a'] }] });
	r = withTask(r, 'parent.child', { allocate: [{ candidates: ['a'] }] });
	r = withTask(r, 'late', { allocate: [{ candidates: ['c'] }] });
	return planFrom({ 'plan.tjp': INLINE_TEXT }, 'plan.tjp', r);
}

/**
 * The review's week-move repros (T12 review, 2026-11-17), one person per task so nothing levels:
 * holidays on Wednesday 21 and Friday 23 January and the whole week of 2 February; `fri` on a
 * Friday, `alap` ending Friday 30 January, `off` in the week before the week off, `jan29` near a
 * month end, `mon` on a Monday, `long` over two weeks.
 */
export const REPRO_TEXT = `project p "P" 2026-01-05 - 2026-03-02 {
}
leaves holiday "Mid" 2026-01-21
leaves holiday "Fri" 2026-01-23
leaves holiday "Week off" 2026-02-02 - 2026-02-07
resource a "A"
resource b "B"
resource c "C"
resource d "D"
resource e "E"
resource f "F"
task fri "Fri" {
  start 2026-01-16
  effort 1d
  allocate a
}
task alap "Alap" {
  end 2026-01-31
  scheduling alap
  effort 2d
  allocate b
}
task off "Off" {
  start 2026-01-28
  effort 1d
  allocate c
}
task jan29 "Jan29" {
  start 2026-01-29
  effort 1d
  allocate d
}
task mon "Mon" {
  start 2026-01-12
  effort 1d
  allocate e
}
task long "Long" {
  start 2026-01-05
  effort 10d
  allocate f
}
`;

/** `REPRO_TEXT` with a hand-made result (the dates TaskJuggler gives it; engine-checked). */
export function reproPlan(): Plan {
	const off = new Set([16, 18, 28, 29, 30, 31, 32]);
	const workingTime = Array.from({ length: 56 }, (_, d) => d)
		.filter((d) => d % 7 < 5 && !off.has(d))
		.map((d) => [at(d, 9), at(d, 17)] as [number, number]);
	const r = resultOf(
		[
			['fri', { start: at(11, 9), end: at(11, 17) }],
			['alap', { start: at(24, 9), end: at(25, 17), alap: true }],
			['off', { start: at(23, 9), end: at(23, 17) }],
			['jan29', { start: at(24, 9), end: at(24, 17) }],
			['mon', { start: at(7, 9), end: at(7, 17) }],
			['long', { start: at(0, 9), end: at(11, 17) }],
		],
		{ workingTime },
	);
	return planFrom({ 'plan.tjp': REPRO_TEXT }, 'plan.tjp', r);
}

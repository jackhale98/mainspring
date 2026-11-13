// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Builders for the schedule tests: a project whose frame starts on Monday 2026-01-05 00:00 UTC
 * with Mon-Fri 09:00-17:00 working time (TaskJuggler's default), and task results with
 * dependencies, without an engine. `at(day, hour)` gives the minutes of a working-day instant.
 */
import type {
	DependencyResult,
	Minutes,
	ProjectInfo,
	ScheduleResult,
	TaskResult,
	TaskScenarioResult,
} from '../../engine/protocol';

export const DAY = 1440;
export const H = 60;

/** Minutes of `hour` o'clock on frame day `day` (day 0 is Monday 2026-01-05). */
export const at = (day: number, hour: number): Minutes => day * DAY + hour * H;

/** Mon-Fri `from`-`to` o'clock for `days` calendar days from day 0, as [start, end) pairs. */
export function weekdays(days: number, from = 9, to = 17): Array<[Minutes, Minutes]> {
	const out: Array<[Minutes, Minutes]> = [];
	for (let d = 0; d < days; d++) if (d % 7 < 5) out.push([at(d, from), at(d, to)]);
	return out;
}

export function project(over: Partial<ProjectInfo> = {}): ProjectInfo {
	return {
		id: 'p',
		name: 'P',
		version: null,
		start: '2026-01-05T00:00:00Z',
		end: '2026-03-02T00:00:00Z',
		now: '2026-01-05T00:00:00Z',
		timezone: null,
		timingResolutionMin: 60,
		scenarios: [{ id: 'plan', name: 'Plan', parent: null, active: true }],
		dailyWorkingHours: 8,
		weeklyWorkingDays: 5,
		monthlyWorkingDays: 260.714 / 12,
		yearlyWorkingDays: 260.714,
		workingTime: weekdays(56),
		...over,
	};
}

/** A dependency entry: `onEnd` defaults to the `depends` default (true). */
export function dep(task: string, over: Partial<DependencyResult> = {}): DependencyResult {
	return { task, onEnd: true, gapDurationMin: 0, gapLengthMin: 0, ...over };
}

export interface TaskSpec {
	start: Minutes | null;
	end: Minutes | null;
	parent?: string;
	milestone?: boolean;
	alap?: boolean;
	scheduled?: boolean;
	depends?: readonly DependencyResult[];
	precedes?: readonly DependencyResult[];
	/** Results in more scenarios than 'plan', keyed by scenario id. */
	scenarios?: Record<string, Partial<TaskScenarioResult>>;
}

export function taskResult(id: string, s: TaskSpec): TaskResult {
	const base: TaskScenarioResult = {
		scheduled: s.scheduled ?? (s.start !== null && s.end !== null),
		start: s.start,
		end: s.end,
		allocated: [],
		criticalness: 0,
		pathCriticalness: 0,
		direction: s.alap ? 'alap' : 'asap',
		complete: null,
		depends: [...(s.depends ?? [])],
		precedes: [...(s.precedes ?? [])],
	};
	const scenarios: Record<string, TaskScenarioResult> = { plan: base };
	for (const [k, v] of Object.entries(s.scenarios ?? {})) scenarios[k] = { ...base, ...v };
	return {
		id,
		name: id,
		parent: s.parent ?? null,
		source: null,
		milestone: s.milestone ?? false,
		scenarios,
	};
}

/** A result from task specs in declaration pre-order. */
export function plan(
	tasks: ReadonlyArray<readonly [string, TaskSpec]>,
	over: Partial<ProjectInfo> = {},
	ok = true,
): ScheduleResult {
	return {
		revision: 1,
		ok,
		project: project(over),
		tasks: tasks.map(([id, s]) => taskResult(id, s)),
		resources: [],
		bookings: [],
		messages: [],
		timings: { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 },
	};
}

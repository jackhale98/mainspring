// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * TaskJuggler's own messages that H4 and H9 report (phase-3.md section 12): which of the result's
 * messages belong to the shown scenario, the task each names, and the dates in a constraint
 * warning. The texts are TaskJuggler 3.8.4's (TaskScenario.rb: `postScheduleCheck` for the
 * constraint warnings and `allocate_no_assigned`, `priority_inversion` with its
 * `priority_inversion_info` lines, `finishScheduling`'s `overbooked_*`). Engine messages keep
 * TaskJuggler's text (strings.ts); this module only reads them.
 */
// T11: the messages carry the task only in their text, so the id is read from it and kept only
// when the result has that task. A date is read with its offset ("2026-01-08-09:00-+0000",
// TjTime#to_s), so it is the instant TaskJuggler printed, whatever the plan's zone.
import type { EngineMessage, Minutes, ScheduleResult } from '../../engine/protocol';
import type { TaskId } from '../tjp/index';
import type { ResourceWarningId } from './types';

export type LimitId = 'minstart' | 'maxstart' | 'minend' | 'maxend';

export const LIMITS: readonly LimitId[] = ['minstart', 'maxstart', 'minend', 'maxend'];
export const RESOURCE_WARNINGS: readonly ResourceWarningId[] = [
	'allocate_no_assigned',
	'priority_inversion',
	'overbooked_effort',
	'overbooked_length',
	'overbooked_duration',
];

const TASK_PATTERNS: Readonly<Record<string, RegExp>> = {
	minstart: /\bof task (\S+) is too early\b/,
	maxstart: /\bof task (\S+) is too late\b/,
	minend: /\bof task (\S+) is too early\b/,
	maxend: /\bof task (\S+) is too late\b/,
	allocate_no_assigned: /^Task (\S+) has resource allocation requested\b/,
	priority_inversion: /\bstole resources from (\S+) despite\b/,
	priority_inversion_info: /^Task (\S+)$/,
	overbooked_effort: /\bfor task (\S+) exceeds\b/,
	overbooked_length: /\bfor task (\S+) exceeds\b/,
	overbooked_duration: /\bfor task (\S+) exceeds\b/,
};

/** Whether the message is about the shown scenario (or about none). */
export const inScenario = (m: EngineMessage, scenario: string): boolean =>
	m.scenario === null || m.scenario === scenario;

/** The task a message names, when the result has it. */
export function messageTask(m: EngineMessage, known: ReadonlySet<TaskId>): TaskId | null {
	const id = TASK_PATTERNS[m.id]?.exec(m.text)?.[1] ?? null;
	return id !== null && known.has(id) ? id : null;
}

const DATE = /(\d{4})-(\d{2})-(\d{2})-(\d{2}):(\d{2})-([+-])(\d{2})(\d{2})/g;

/**
 * The two dates of a constraint warning, in minutes since the project start: the task's date and
 * the limit ("The start time (A) of task t is too late. Must be before B."), or null.
 */
export function warningDates(
	m: EngineMessage,
	r: Pick<ScheduleResult, 'project'>,
): { date: Minutes; limit: Minutes } | null {
	if (!r.project) return null;
	const start = Date.parse(r.project.start);
	const found: number[] = [];
	for (const x of m.text.matchAll(DATE)) {
		const [, y, mo, d, h, mi, sign, oh, om] = x;
		const iso = `${y}-${mo}-${d}T${h}:${mi}:00${sign}${oh}:${om}`;
		const t = Date.parse(iso);
		if (Number.isFinite(t)) found.push(Math.round((t - start) / 60_000));
	}
	const [date, limit] = found;
	return found.length === 2 && date !== undefined && limit !== undefined ? { date, limit } : null;
}

/**
 * The `priority_inversion_info` lines after message `i` (TaskJuggler emits them right after the
 * warning), as the tasks they name.
 */
export function inversionTasks(
	messages: readonly EngineMessage[],
	i: number,
	known: ReadonlySet<TaskId>,
): TaskId[] {
	const out: TaskId[] = [];
	for (let j = i + 1; j < messages.length; j++) {
		const m = messages[j] as EngineMessage;
		if (m.id !== 'priority_inversion_info') break;
		const t = messageTask(m, known);
		if (t !== null && !out.includes(t)) out.push(t);
	}
	return out;
}

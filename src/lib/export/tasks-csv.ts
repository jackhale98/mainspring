// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The tasks as CSV rows (phase-4.md 18.20, T18). One row per task of the schedule result, in the
 * result's order (declaration pre-order, every task, whatever the Gantt has collapsed or
 * filtered), with the columns id, name, start, end, effort, people and complete.
 *
 * Everything is read, nothing is computed (ADR-0007):
 * - start and end are the engine's minutes written as `YYYY-MM-DD HH:mm` with `Intl` in the plan's
 *   time zone (UTC when the plan sets none, or `Intl` does not know it). The end is the instant the
 *   work stops, as the engine gives it: a task that ends at midnight ends on the next day's 00:00.
 *   A task the engine did not schedule has both empty;
 * - effort is the task's own `effort` in the plan's words ("4d"), from the index; empty for a task
 *   whose size is a `length` or `duration`, for a container, and where the statement is a macro;
 * - people are the allocated people's names, joined by "; " (a comma would be quoted);
 * - complete is the plan's `complete` in percent, empty when the plan sets none.
 *
 * The end stays the exact instant (TaskJuggler's own `end`, lossless), not the last day worked: the
 * Gantt's END column shows the day of `end - 1 minute`, so a task that ends at midnight reads one
 * day earlier there than here (pinned in the test).
 *
 * Known choice: the fields are the plan's own text, unaltered. A task name that starts with `=`,
 * `+`, `-` or `@` is read as a formula by some spreadsheets; guarding against that would change the
 * data (a leading quote), so the file does not.
 */
import type { Minutes, ProjectInfo, ScheduleResult } from '../../engine/protocol';
import { sizingSite } from '../gantt/grid';
import type { TaskSymbol } from '../tjp/index';
import { printDuration } from '../tjp/values';

export const TASK_COLUMNS = ['id', 'name', 'start', 'end', 'effort', 'people', 'complete'] as const;

const MINUTE_MS = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
	let f = formatters.get(zone);
	if (!f) {
		const make = (timeZone: string): Intl.DateTimeFormat =>
			new Intl.DateTimeFormat('en-US', {
				timeZone,
				hourCycle: 'h23',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
			});
		try {
			f = make(zone);
		} catch (error) {
			if (!(error instanceof RangeError)) throw error;
			f = make('UTC');
		}
		formatters.set(zone, f);
	}
	return f;
}

/** `m` minutes after the project start as `YYYY-MM-DD HH:mm` in the plan's zone. */
export function csvDate(m: Minutes, project: Pick<ProjectInfo, 'start' | 'timezone'>): string {
	const at = new Date(Date.parse(project.start) + m * MINUTE_MS);
	const part: Record<string, string> = {};
	for (const p of formatter(project.timezone ?? 'UTC').formatToParts(at)) part[p.type] = p.value;
	// Some engines write midnight as "24" even for h23.
	const hour = part['hour'] === '24' ? '00' : (part['hour'] ?? '00');
	return `${(part['year'] ?? '').padStart(4, '0')}-${part['month']}-${part['day']} ${hour}:${part['minute']}`;
}

/** What a task says about its own `effort` in the shown scenario ("4d"), or an empty string. */
export function effortWords(sym: TaskSymbol | undefined, chain: readonly string[]): string {
	const a = sizingSite(sym, chain);
	if (a === null || a.keyword !== 'effort' || a.textOnly) return '';
	const v = a.parsed;
	if (v?.kind !== 'duration') return '';
	const text = printDuration(v.value);
	return text.ok ? text.value : '';
}

export interface TasksCsvInput {
	readonly result: ScheduleResult;
	/** The scenario whose dates are written (the one the Gantt shows). */
	readonly scenario: string | null;
	/** The shown scenario and its parents, nearest first (`scenarioChain`). */
	readonly chain: readonly string[];
	/** The index's task by full id. */
	readonly symbol: (id: string) => TaskSymbol | undefined;
}

/** The header row and a row for every task. */
export function taskRows(i: TasksCsvInput): string[][] {
	const { result, scenario } = i;
	const project = result.project;
	const names = new Map(result.resources.map((r) => [r.id, r.name]));
	const rows: string[][] = [[...TASK_COLUMNS]];
	for (const t of result.tasks) {
		const s = scenario === null ? undefined : t.scenarios[scenario];
		const dated = !!project && !!s && s.scheduled && s.start !== null && s.end !== null;
		rows.push([
			t.id,
			t.name,
			dated ? csvDate(s.start as Minutes, project) : '',
			dated ? csvDate(s.end as Minutes, project) : '',
			effortWords(i.symbol(t.id), i.chain),
			(s?.allocated ?? []).map((id) => names.get(id) ?? id).join('; '),
			s?.complete == null ? '' : String(s.complete),
		]);
	}
	return rows;
}

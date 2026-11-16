// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * An empty plan is not an error (ADR-0013 #3; phase-3.md 9.8). A header-only plan makes the
 * engine stop with `no_tasks` and `ok: false`. That one case reads as "No tasks yet": no error
 * count, no "not scheduled" line, no pin. It is empty only when the engine says nothing else
 * is wrong, the result has no tasks and, when the index is current, the text declares none. A plan
 * whose text declares tasks, but whose engine run still says `no_tasks`, stays an error.
 */
import type { EngineMessage, ScheduleResult } from '../../engine/protocol';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import type { SymbolIndex } from '../tjp/index';

/** The engine's message id for a plan without a task. */
export const NO_TASKS = 'no_tasks';

const isError = (m: EngineMessage): boolean => m.level === 'error' || m.level === 'fatal';

/** The result stopped for no other reason than that the plan has no task. */
export function isEmptyResult(r: ScheduleResult): boolean {
	if (r.ok || r.tasks.length > 0) return false;
	const errors = r.messages.filter(isError);
	return errors.length > 0 && errors.every((m) => m.id === NO_TASKS);
}

/** Whether a diagnostic is the empty plan's own. */
export const isNoTasks = (d: TjpDiagnostic): boolean =>
	d.source === 'engine' && d.messageId === NO_TASKS;

/**
 * The plan is empty: the newest result is an empty one, no other error is shown (a syntax error
 * in the text is not an empty plan), and the index, when it is of the current text, has no task.
 */
export function isEmptyPlan(s: {
	readonly latest: { readonly result: ScheduleResult } | null;
	readonly diagnostics: readonly TjpDiagnostic[];
	readonly index: Pick<SymbolIndex, 'tasks'>;
	readonly indexVersion: number;
	readonly version: number;
}): boolean {
	if (!s.latest || !isEmptyResult(s.latest.result)) return false;
	if (s.diagnostics.some((d) => d.severity === 'error' && !isNoTasks(d))) return false;
	return s.indexVersion !== s.version || s.index.tasks.size === 0;
}

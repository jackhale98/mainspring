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
 * The edit deletes every task of the plan it was prepared on: a `deleteTask` of a task (and its
 * subtasks) and nothing else is left. Only such an edit settles as "Deleted. The plan has no
 * tasks."; the index is the one the edit was planned on, not the published one, which can lag.
 */
export function emptiesPlan(
	index: Pick<SymbolIndex, 'tasks'>,
	intent: { readonly type: string; readonly task?: string },
): boolean {
	if (intent.type !== 'deleteTask' || intent.task === undefined) return false;
	const id = intent.task;
	if (!index.tasks.has(id)) return false;
	for (const key of index.tasks.keys()) {
		if (key !== id && !key.startsWith(`${id}.`)) return false;
	}
	return true;
}

/**
 * The plan is empty: the newest result is an empty one and describes the text as it is (a result
 * of older text is no answer about this one), no other error is shown (a syntax error in the text
 * is not an empty plan), and the index, when it is of that text, has no task. An index of other
 * text is not consulted.
 */
export function isEmptyPlan(s: {
	readonly latest: { readonly result: ScheduleResult; readonly workspaceVersion: number } | null;
	readonly diagnostics: readonly TjpDiagnostic[];
	readonly index: Pick<SymbolIndex, 'tasks'>;
	readonly indexVersion: number;
	readonly version: number;
}): boolean {
	if (!s.latest || !isEmptyResult(s.latest.result)) return false;
	if (s.latest.workspaceVersion !== s.version) return false;
	if (s.diagnostics.some((d) => d.severity === 'error' && !isNoTasks(d))) return false;
	return s.indexVersion !== s.version || s.index.tasks.size === 0;
}

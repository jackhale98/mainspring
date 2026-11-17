// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * One task's placement for "Why here?" (phase-3.md 9.7): the explainer on the context compute.ts
 * makes for a result and the index of its text. Apart from compute.ts so that the Health button's
 * count, which a first load fetches compute.ts for, does not carry `explainTask`.
 */
import type { ScheduleResult } from '../../engine/protocol';
import { report } from '../report';
import { explainTask } from '../schedule/explain-task';
import type { ExplainContext, Placement } from '../schedule/explain-types';
import type { SymbolIndex, TaskId } from '../tjp/index';
import { contextFor } from './compute';

/** One task's placement (why it starts or ends where it does), or null when it cannot be told. */
export function placementOf(
	result: ScheduleResult,
	index: SymbolIndex,
	task: TaskId,
): { placement: Placement; ctx: ExplainContext } | null {
	try {
		const ctx = contextFor(result, index);
		return ctx ? { placement: explainTask(task, ctx), ctx } : null;
	} catch (error) {
		report(error);
		return null;
	}
}

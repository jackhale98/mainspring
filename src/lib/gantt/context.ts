// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The `ActionContext` the Gantt plans previews with (phase-2.md 7.3): the symbol index, the
 * result it draws and its analysis, and the working time of that result. It serves the previews
 * only (`resizeEdge`, `earliestStart`, `latestEnd`, the live label); the dispatcher builds its own
 * for an edit, from a fresh index, so a preview made on a lagging index is never what is applied.
 */
import type { ScheduleResult } from '../../engine/protocol';
import { workingTimeOf, type WorkingTime } from '../schedule/working-time';
import type { SymbolIndex } from '../tjp/index';
import type { ZoneOffsets } from '../tjp/values/civil';
import type { ActionContext } from './intents';
import type { DrivingAnalysis } from '../schedule/critical';

const workingTimes = new WeakMap<ScheduleResult, WorkingTime | null>();

/** A result's working time, built once per result (null without a project). */
export function workingTimeFor(
	result: ScheduleResult | null,
	zones?: ZoneOffsets,
): WorkingTime | null {
	if (!result?.project) return null;
	if (!workingTimes.has(result)) workingTimes.set(result, workingTimeOf(result.project, zones));
	return workingTimes.get(result) ?? null;
}

export function previewContext(
	index: SymbolIndex | null,
	shown: { readonly result: ScheduleResult | null; readonly analysis: DrivingAnalysis | null },
	zones?: ZoneOffsets,
): ActionContext | null {
	if (!index) return null;
	return {
		index,
		result: shown.result,
		analysis: shown.analysis,
		wt: workingTimeFor(shown.result, zones),
		...(zones ? { zones } : {}),
		move: null,
	};
}

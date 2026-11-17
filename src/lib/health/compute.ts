// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the health panel and "Why here?" need from one result (phase-3.md 6.3, 6.4, 8.3): the
 * explainer's context, the demand marks, the health report, and one task's placement. This is the
 * lazy half of plan health: a first load imports it in an idle task after the first result
 * (`state/health.svelte.ts`), so it holds the checks and the demand only: the explainer's
 * `explainTask` is why.ts, which the "Why here?" UI imports, and the panel's grouping is
 * panel-model.ts. Display data (ADR-0007): the report and the
 * placements are read from the result and the text, never sent to the engine.
 *
 * - **One context per result and index.** The explainer reads the text through the index, which
 *   can narrow what books (`limits`, `shifts`), so the context is kept for the index it was made
 *   with, as the heatmap keeps its demand (`workload/heat-state.svelte.ts`).
 * - **Demand once per context** (its first call in a fresh worker is 8 to 21 ms on fedora-res).
 * - **The scenario** is the one the Gantt draws (`finishScenario`), as the driving analysis is.
 *   A result that has no project, no scenario or no analysis has no context: the callers say so.
 * - **Errors** in the checks go to the app's error path (report.ts) and give no report; the count
 *   then stays as it was.
 */
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { analysisOf } from '../gantt/analysis';
import { report } from '../report';
import { demandOf } from '../schedule/demand';
import type { DemandMarks, ExplainContext } from '../schedule/explain-types';
import { finishScenario } from '../schedule/finish';
import { workingTimeOf } from '../schedule/working-time';
import type { SymbolIndex } from '../tjp/index';
import { availabilityOf } from '../workload/availability';
import { newFindings } from './panel-model';
import { checkPlan } from './report';
import { readHealthSettings, writeHealthSettings } from './settings';
import type { HealthReport, HealthSettings } from './types';

export const HEALTH_MEASURE = 'mainspring:health-check';

/** One zone host for the life of the page: the working time of every result is read with it. */
const zones = createTimeZoneHost();

interface Made {
	readonly index: SymbolIndex;
	readonly ctx: ExplainContext | null;
	marks: DemandMarks | null;
}
const made = new WeakMap<ScheduleResult, Made>();

/** The explainer's context for a result and the index of its text, or null (see the header). */
export function contextFor(result: ScheduleResult, index: SymbolIndex): ExplainContext | null {
	const known = made.get(result);
	if (known && known.index === index) return known.ctx;
	let ctx: ExplainContext | null = null;
	const project = result.project;
	const scenario = finishScenario(result);
	const analysis = analysisOf(result);
	if (project && scenario !== null && analysis) {
		ctx = {
			result,
			scenario,
			index,
			analysis,
			wt: workingTimeOf(project, zones),
			availability: availabilityOf(result, scenario),
		};
	}
	made.set(result, { index, ctx, marks: null });
	return ctx;
}

/** Held and unmet work of a context, once. */
function marksOf(ctx: ExplainContext): DemandMarks {
	const m = made.get(ctx.result);
	if (m?.marks) return m.marks;
	const marks = demandOf(ctx);
	if (m) m.marks = marks;
	return marks;
}

/** The health report of a result under the settings, or null when it cannot be checked. */
export function computeHealth(
	result: ScheduleResult,
	index: SymbolIndex,
	settings: HealthSettings,
): HealthReport | null {
	try {
		const ctx = contextFor(result, index);
		if (!ctx) return null;
		const t0 = performance.now();
		const out = checkPlan({
			index,
			result,
			analysis: ctx.analysis,
			demand: marksOf(ctx),
			wt: ctx.wt,
			settings,
			availability: ctx.availability,
		});
		try {
			performance.measure(HEALTH_MEASURE, {
				start: t0,
				end: performance.now(),
				detail: { findings: out.findings.length, revision: result.revision },
			});
		} catch {
			// A runtime without User Timing Level 3 still gets the report.
		}
		return out;
	} catch (error) {
		report(error);
		return null;
	}
}

export { newFindings, readHealthSettings, writeHealthSettings };

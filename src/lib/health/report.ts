// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `checkPlan` (phase-3.md 6.4, section 12): every check that `settings.enabled` leaves on, over one
 * result in the driving analysis's scenario, its demand marks and the index. Pure display data
 * (ADR-0007): findings are never sent to the engine. Findings come in `CheckId` order, and within
 * a check in task pre-order (H4 and H9 in message order); `counts` has every check, 0 for one
 * with no finding or turned off.
 */
// T11: `HealthInput.availability` is optional: the explainer's context already holds the people's
// availability (`ExplainContext.availability`), and the panel passes it rather than having
// `checkPlan` build it again; without it, it is built from the result when H7 or H8 is on.
import { availabilityOf } from '../workload/availability';
import type { Availability } from '../workload/types';
import { runOf, type Run } from './common';
import { constraintWarnings, hardConstraints } from './constraints';
import { noPredecessor, noSuccessor } from './links';
import { heldByPeople, resourceWarnings, workWithoutPeople } from './people';
import { longGaps, longTasks } from './spans';
import { CHECK_IDS, type CheckId, type CheckPlanFn, type Finding, type HealthInput } from './types';

/** The latest end in the run's scenario, or null. */
function finishOf(run: Run): number | null {
	let max: number | null = null;
	for (const id of run.order) {
		const s = run.scenarioOf(id);
		if (s?.scheduled && s.end !== null && (max === null || s.end > max)) max = s.end;
	}
	return max;
}

export const checkPlan: CheckPlanFn = (i: HealthInput) => {
	const counts = Object.fromEntries(CHECK_IDS.map((c) => [c, 0])) as Record<CheckId, number>;
	const run = runOf(i);
	if (!run) return { revision: i.result.revision, findings: [], counts };
	const on = i.settings.enabled;
	let people: Availability | null = i.availability ?? null;
	const availability = (): Availability => (people ??= availabilityOf(i.result, run.scenario));
	const findings: Finding[] = [];
	if (on['no-predecessor']) findings.push(...noPredecessor(run));
	if (on['no-successor']) findings.push(...noSuccessor(run, finishOf(run)));
	if (on['hard-constraint']) findings.push(...hardConstraints(run));
	if (on['constraint-warning']) findings.push(...constraintWarnings(run));
	if (on['long-gap']) findings.push(...longGaps(run));
	if (on['long-task']) findings.push(...longTasks(run));
	if (on['held-by-people']) findings.push(...heldByPeople(run, i.demand, availability()));
	if (on['work-without-people']) findings.push(...workWithoutPeople(run, i.demand, availability()));
	if (on['resource-warning']) findings.push(...resourceWarnings(run));
	for (const f of findings) counts[f.check]++;
	return { revision: i.result.revision, findings, counts };
};

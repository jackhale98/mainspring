// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * "Why is this here?" for one task (explain.ts has the rules and the pieces): `explainTask`, and the
 * gaps inside an effort leaf's bar (rule 4). Apart from explain.ts because only the "Why here?" UI
 * needs it, and the held and unmet work (demand.ts, health), which a first load makes the Health
 * button's count from, needs only the wait (`waitOf`): see phase-3.md section 25.
 */
import type { TaskScenarioResult } from '../../engine/protocol';
import type { TaskId } from '../tjp/index';
import { subtract } from '../workload/intervals';
import { readWindow, waitOf } from './explain';
import { prepOf, type Prep } from './explain-prep';
import { narrowsBooking, scenarioChainOf, sizeKindOf } from './explain-text';
import type { Cause, ExplainContext, ExplainTaskFn, Placement } from './explain-types';

/** The gaps inside an effort leaf's bar and what they show (rule 4). */
export function insideOf(
	id: TaskId,
	s: TaskScenarioResult,
	ctx: ExplainContext,
	prep: Prep,
): Cause[] {
	const out: Cause[] = [];
	if (s.start === null || s.end === null) return out;
	const seen = new Set<string>();
	const narrowed = narrowsBooking(ctx.index, id);
	for (const [a, b] of subtract([[s.start, s.end]], prep.booked(id))) {
		const { causes, free } = readWindow(id, s, a, b, ctx, prep, narrowed);
		if (free || causes[0]?.kind === 'unknown') {
			for (const c of causes) {
				const key = c.kind === 'limit' ? `${c.site.file}:${c.site.from}` : c.kind;
				if (!seen.has(key)) out.push(c);
				seen.add(key);
			}
			continue;
		}
		for (const c of causes) if (c.kind !== 'off-hours' || c.resource !== null) out.push(c);
	}
	return out;
}

export const explainTask: ExplainTaskFn = (id, ctx): Placement => {
	const prep = prepOf(ctx);
	const s = prep.scenarioOf(id);
	const anchor = s?.direction === 'alap' ? 'end' : 'start';
	const at = s ? (anchor === 'end' ? s.end : s.start) : null;
	if (!s || !s.scheduled || at === null) {
		return { task: id, anchor, bound: null, at: null, causes: [], inside: [] };
	}
	const wait = waitOf(id, s, ctx, prep);
	const bound = wait.bound.causes;
	const causes =
		wait.window === null && wait.causes[0]?.kind === 'unknown'
			? wait.causes
			: anchor === 'start'
				? [...bound, ...wait.causes]
				: [...wait.causes, ...bound];
	const chain = scenarioChainOf(ctx.result.project, ctx.scenario);
	const effortLeaf = !prep.containers.has(id) && sizeKindOf(ctx.index, id, chain) === 'effort';
	return {
		task: id,
		anchor,
		bound: wait.bound.bound,
		at,
		causes,
		inside: effortLeaf ? insideOf(id, s, ctx, prep) : [],
	};
};

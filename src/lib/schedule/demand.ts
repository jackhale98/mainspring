// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Held and unmet work per person (phase-3.md 5.4, 6.3; ADR-0014 #3), for the load model's `held`
 * and `unmet` (`LoadInput.demand`) and for health checks H7 and H8. Display data (ADR-0007): an
 * interpretation of one result, labelled as read from the schedule; never sent to the engine.
 *
 * - **Held** (rule 2): an effort leaf whose anchor is off its bound, where no person it asked for
 *   had free time in the wait (explain.ts `waitOf`). It is held for each person with a busy or
 *   leave stretch of their own in the wait, over the whole wait: [bound, start) for ASAP,
 *   [end, bound) for ALAP. A wait that only the project's calendar fills (nights, global holidays
 *   for everyone) holds nobody.
 * - **Unmet** (rule 3): a `length` or `duration` leaf, over [start, end). An `allocate` item is
 *   met in a slot when one of its people (any candidate, groups as their members) is booked on the
 *   task there. Where it is not, each of its people booked on another task has unmet work: those
 *   slots, as runs joined across their off hours (never across working or leave time).
 * - **Keys and entries.** Keyed by leaf person. One entry per task and disjoint window, in task
 *   pre-order, then window order. The minutes of an entry are its window intersected with the
 *   person's `workingTime` (the load model does that): booked time elsewhere, and 0 on leave.
 */
// T10: rule 3 reads per person ("an `allocate` candidate ... booked on another task"). With
// alternatives or a group, that would mark Ann unmet while the task ran with Bo, the alternative
// TaskJuggler booked; so an item counts as met when any of its people is on the task, and only
// then are its people booked elsewhere unmet. Leave is not unmet (rule 3: booked on another task).
// T10: a task whose size the index cannot see (a macro) is neither held nor unmet: rule 2's held
// is for effort tasks (5.4) and rule 3's unmet for length and duration tasks.
// T10: held is per person with a busy or leave stretch of their own in the wait. A wait filled only
// by the project calendar (nights, a global holiday everyone has) holds nobody: 5.4's "booked
// elsewhere or on leave" is about the people, and H7 would otherwise say "Waits 0 days for Dev".
import type { Minutes, TaskScenarioResult } from '../../engine/protocol';
import type { ResourceId, TaskId } from '../tjp/index';
import { allLeave } from '../workload/availability';
import { mergePairs, overlaps, subtract } from '../workload/intervals';
import type { IntervalSet, PersonAvailability } from '../workload/types';
import { waitOf } from './explain';
import { clip, prepOf, type Prep } from './explain-prep';
import { scenarioChainOf, sizeKindOf } from './explain-text';
import type { DemandEntry, DemandMarks, DemandOfFn, ExplainContext } from './explain-types';

type Pair = readonly [Minutes, Minutes];

export const demandOf: DemandOfFn = (ctx) => {
	const prep = prepOf(ctx);
	const chain = scenarioChainOf(ctx.result.project, ctx.scenario);
	const held = new Map<ResourceId, DemandEntry[]>();
	const unmet = new Map<ResourceId, DemandEntry[]>();
	const push = (m: Map<ResourceId, DemandEntry[]>, p: ResourceId, e: DemandEntry): void => {
		let list = m.get(p);
		if (!list) m.set(p, (list = []));
		list.push(e);
	};
	const hours = new Map<ResourceId, IntervalSet>();
	const hoursOf = (id: ResourceId, person: PersonAvailability): IntervalSet => {
		let h = hours.get(id);
		if (!h) hours.set(id, (h = mergePairs([...person.working, ...allLeave(person)])));
		return h;
	};

	for (const t of ctx.result.tasks) {
		const s = prep.scenarioOf(t.id);
		if (!s?.scheduled || s.start === null || s.end === null || s.allocate.length === 0) continue;
		if (t.milestone || prep.containers.has(t.id)) continue;
		const kind = sizeKindOf(ctx.index, t.id, chain);
		if (kind === 'effort') {
			const wait = waitOf(t.id, s, ctx, prep);
			if (wait.window === null) continue;
			for (const p of wait.held) push(held, p, { task: t.id, window: [...wait.window] });
		} else if (kind === 'length' || kind === 'duration') {
			for (const [p, windows] of unmetOf(t.id, s, ctx, prep, hoursOf)) {
				for (const window of windows) push(unmet, p, { task: t.id, window });
			}
		}
	}
	return { held, unmet } satisfies DemandMarks;
};

/** Each person's unmet runs on a length or duration leaf (rule 3), in `allocate` order. */
export function unmetOf(
	id: TaskId,
	s: TaskScenarioResult,
	ctx: ExplainContext,
	prep: Prep,
	hoursOf: (id: ResourceId, person: PersonAvailability) => IntervalSet,
): Map<ResourceId, Array<[Minutes, Minutes]>> {
	const from = s.start as Minutes;
	const to = s.end as Minutes;
	const slots = new Map<ResourceId, Pair[]>();
	for (const item of s.allocate) {
		const ids = [...new Set(item.candidates.flatMap((c) => prep.leavesOf(c)))];
		const served = mergePairs(ids.flatMap((p) => clip(prep.own(p, id), from, to)));
		for (const p of ids) {
			const person = ctx.availability.people.get(p);
			if (!person) continue;
			// The person's own bookings on the task are inside `served`.
			const elsewhere = subtract(clip(person.booked, from, to), served);
			if (elsewhere.length === 0) continue;
			let list = slots.get(p);
			if (!list) slots.set(p, (list = []));
			list.push(...elsewhere);
		}
	}
	const out = new Map<ResourceId, Array<[Minutes, Minutes]>>();
	for (const [p, list] of slots) {
		const person = ctx.availability.people.get(p) as PersonAvailability;
		const h = hoursOf(p, person);
		const runs: Array<[Minutes, Minutes]> = [];
		for (const [a, b] of mergePairs(list)) {
			const last = runs[runs.length - 1];
			if (last && !overlaps(h, last[1], a)) last[1] = b;
			else runs.push([a, b]);
		}
		out.set(p, runs);
	}
	return out;
}

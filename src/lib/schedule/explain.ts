// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * "Why is this here?" (phase-3.md 6.3, 9.7; ADR-0014 #4): why a task starts (ASAP) or ends (ALAP)
 * where the engine put it, and why its effort bar has gaps. Display data (ADR-0007): read from one
 * result, its people's availability and the text; never sent to the engine, never a date. It names
 * what the schedule shows and never says "would have started"; when it cannot tell, it says
 * `unknown` ("The schedule does not show why.").
 *
 * - **Bound** (rule 1). ASAP: the latest of each `depends` entry's earliest start (Phase 2's
 *   `earliestUnder`: `gaplength` over the project's working time, `gapduration` over calendar
 *   time), a `start` written on the task or an ancestor, and the project start. ALAP: the earliest
 *   of each `precedes` entry's latest end (`latestUnder`), a written `end` and the project end.
 *   The items that give the bound are its causes (`dependency`, `constraint`, or `frame` when
 *   nothing else does); they are listed whether or not the anchor sits on the bound.
 * - **The wait** (rule 2) is [bound, at) for ASAP and [at, bound) for ALAP. Without free time for
 *   any person the task asked for (groups as their members), it is split into `busy`, `leave` and
 *   `off-hours` causes that partition it (explain-window.ts). With free time, a `limits` statement
 *   on the task, an ancestor or that person "may" hold it (`limit`), else `unknown`. When the text
 *   narrows when the task may book (`shifts`, an `allocate` body: explain-text.ts
 *   `narrowsBooking`), a wait in which any of its people had working time is `unknown`, and nobody
 *   is held: the engine data does not show what the narrowing excluded.
 * - **Inside** (rule 4): for an effort leaf, each gap between its bookings inside [start, end),
 *   explained the same way, without the project calendar's off hours: a night or a weekend is not
 *   a gap in the bar's working time, and a gap that is only those has no cause. A person's own off
 *   hours stay (a part-timer's afternoons), as do leave and busy stretches. A `limit` or `unknown`
 *   appears once, at its first gap.
 * - **Order.** In time order: for ASAP the bound's causes, then the wait's; for ALAP the wait's,
 *   then the bound's.
 * - **Cost.** One task: its dependencies, its people's interval sets clipped to the window by
 *   binary search, and the index's sites for the task. The result-wide tables are built once per
 *   result (explain-prep.ts).
 */
// T10: rule 1 gives the bound's item as the cause "when `at` equals `bound`". The bound's items are
// listed whenever there is a bound, before the wait (9.7: "Waits for Design (ends Tue 3 Mar)."
// then "Dev 1 is booked on Build API ..."). "Equals" is within one timing slot below the bound: a
// `gapduration` off the slot grid gives a bound inside a slot, and the task's first slot is the one
// that holds it (dateToIdx truncates).
// T10: an anchor a whole slot or more on the wrong side of the bound (a result that is not ok, a
// `start` written before a predecessor's end: `task_pred_before`) is `unknown`: the bound does not
// hold, so the schedule does not show why.
// T10: a container takes its dates from its children (TaskScenario#scheduleContainer); there is no
// cause for "its first child", so a container off its bound is `unknown`, and it has no inside.
// T10: a container, or a task without people, whose wait holds no project working time at all
// (Mon 00:00 to the first working slot) gets the project's off hours there, not `unknown`.
// T10: `inside` leaves out the project calendar's off hours (rule 4: "gaps between its bookings";
// a night is not a gap in the bar's working time), so the partition property is for `causes`.
// T10: from the review (F1): with task `shifts` (own or inherited, any scenario) or an `allocate`
// body, a busy stretch or a free hour may lie outside what the task could book, so the wait (and
// each gap inside) is `unknown` once a person had working time in it. A wait where every person
// was off or on leave is still explained by their calendars: a shift only narrows when a task may
// book, never widens a person's working time (TaskScenario#bookResources), so those causes stay
// true. Nothing is held either way.
import type { DependencyResult, Minutes, TaskScenarioResult } from '../../engine/protocol';
import type { ResourceId, SourceRange, TaskId } from '../tjp/index';
import { overlaps, subtract } from '../workload/intervals';
import type { PersonAvailability } from '../workload/types';
import { earliestUnder } from './critical';
import { prepOf, type Prep } from './explain-prep';
import {
	narrowsBooking,
	personLimitSite,
	scenarioChainOf,
	sizeKindOf,
	taskLimitSites,
	writtenDates,
} from './explain-text';
import type { Cause, ExplainContext, ExplainTaskFn, Placement } from './explain-types';
import { hadFree, windowCauses } from './explain-window';
import { latestUnder } from './float';
import type { Edge } from './graph';

const UNKNOWN: Cause = { kind: 'unknown' };
const FRAME: Cause = { kind: 'frame' };

/** The person data of the leaf people a task asked for, in `allocate` order, groups expanded. */
export function peopleOf(
	s: TaskScenarioResult,
	prep: Prep,
): Array<{ id: ResourceId; person: PersonAvailability }> {
	const out: Array<{ id: ResourceId; person: PersonAvailability }> = [];
	const seen = new Set<ResourceId>();
	for (const item of s.allocate) {
		for (const c of item.candidates) {
			for (const id of prep.leavesOf(c)) {
				const person = prep.availability.people.get(id);
				if (person && !seen.has(id)) {
					seen.add(id);
					out.push({ id, person });
				}
			}
		}
	}
	return out;
}

/** The graph edge of a resolved entry (graph.ts), for `earliestUnder` and `latestUnder`. */
const edgeOf = (d: DependencyResult, via: 'depends' | 'precedes'): Edge => ({
	pred: -1,
	predEnd: via === 'depends' ? d.onEnd : true,
	succ: -1,
	succEnd: via === 'depends' ? false : d.onEnd,
	gapLength: d.gapLengthMin,
	gapDuration: d.gapDurationMin,
	via,
	link: '',
});

interface Bound {
	readonly bound: Minutes | null;
	readonly causes: readonly Cause[];
}

/**
 * The date TaskJuggler holds for a `start` (ASAP) or `end` (ALAP) the index cannot read (a macro):
 * the anchor of the task it is written on, when that anchor shows the date: a container, a length,
 * duration or milestone leaf, or a leaf without people. An effort leaf's anchor moves to its first
 * (last) booking, and a leaf whose size the index cannot see but which asks for people may be one:
 * null (`unknown`).
 */
// T10: Fedora writes `start ${start_work}` on its root task, which every task inherits, so without
// this every Fedora task would be `unknown`. A written date fixes the anchor of a task that has it:
// TaskScenario#propagateDateToDep does not move a set date, and #scheduleContainer keeps a
// container's written start when its children start at or after it (they do: #earliestStart bounds
// them by it). An effort leaf books from the date on, so its anchor does not show the date.
// T10: from the review (F2): a macro-written size may be `effort`; trusting that task's anchor
// claimed `constraint` and hid a real wait for a busy person.
function heldDate(
	task: TaskId,
	s: TaskScenarioResult | null,
	alap: boolean,
	ctx: ExplainContext,
	prep: Prep,
): Minutes | null {
	if (!s) return null;
	if (!prep.containers.has(task)) {
		const size = sizeKindOf(ctx.index, task, scenarioChainOf(ctx.result.project, ctx.scenario));
		const shows =
			size === 'length' ||
			size === 'duration' ||
			prep.tasks.get(task)?.milestone === true ||
			(size === null && s.allocate.length === 0);
		if (!shows) return null;
	}
	return alap ? s.end : s.start;
}

/** The bound of a task's anchor and the items that give it (rule 1). */
export function boundOf(id: TaskId, s: TaskScenarioResult, ctx: ExplainContext, prep: Prep): Bound {
	const alap = s.direction === 'alap';
	const items: Array<{ at: Minutes; cause: Cause }> = [];
	for (const d of alap ? s.precedes : s.depends) {
		const other = prep.scenarioOf(d.task);
		const x = other ? (d.onEnd ? other.end : other.start) : null;
		// TaskScenario#earliestStart and #latestEnd give nothing while an entry has no date.
		if (x === null) return { bound: null, causes: [UNKNOWN] };
		const via = alap ? 'precedes' : 'depends';
		const e = edgeOf(d, via);
		items.push({
			at: alap ? latestUnder(e, x, ctx.wt) : earliestUnder(e, x, ctx.wt),
			cause: { kind: 'dependency', pred: d.task, via, gap: d.gapLengthMin + d.gapDurationMin > 0 },
		});
	}
	const chain = scenarioChainOf(ctx.result.project, ctx.scenario);
	for (const w of writtenDates(ctx.index, id, alap ? 'end' : 'start', chain, prep.startEpoch)) {
		const cause: Cause = { kind: 'constraint', attr: w.attr, inherited: w.inherited };
		const at =
			w.at ?? heldDate(w.task, w.task === id ? s : prep.scenarioOf(w.task), alap, ctx, prep);
		if (at === null) return { bound: null, causes: [cause, UNKNOWN] };
		items.push({ at, cause });
	}
	// The frame is the bound when nothing later (ASAP) or earlier (ALAP) gives one.
	let bound: Minutes = alap ? prep.frameEnd : 0;
	for (const it of items) bound = alap ? Math.min(bound, it.at) : Math.max(bound, it.at);
	// Two ancestors may write the same date: one cause each kind, attribute and predecessor.
	const causes = new Map<string, Cause>();
	for (const it of items) if (it.at === bound) causes.set(JSON.stringify(it.cause), it.cause);
	return { bound, causes: causes.size > 0 ? [...causes.values()] : [FRAME] };
}

/**
 * For a window no person's data can explain (a container, a task without people): the project's
 * off hours when the project has no working time in it at all, else `unknown`.
 */
function calendarOr(from: Minutes, to: Minutes, ctx: ExplainContext): Cause {
	return ctx.wt.workingBetween(from, to) === 0
		? { kind: 'off-hours', resource: null, window: [from, to] }
		: UNKNOWN;
}

/** What held the task in [from, to): the windowed causes, or limits, or `unknown` (rule 2). */
export function readWindow(
	id: TaskId,
	s: TaskScenarioResult,
	from: Minutes,
	to: Minutes,
	ctx: ExplainContext,
	prep: Prep,
	narrowed: boolean,
): { causes: Cause[]; free: boolean } {
	const people = peopleOf(s, prep);
	if (people.length === 0) return { causes: [calendarOr(from, to, ctx)], free: false };
	if (narrowed && people.some((p) => overlaps(p.person.working, from, to))) {
		return { causes: [UNKNOWN], free: false };
	}
	const free = people.filter((p) => hadFree(p.person, prep.own(p.id, id), from, to));
	if (free.length === 0) return { causes: windowCauses(id, people, from, to, prep), free: false };
	const chain = scenarioChainOf(ctx.result.project, ctx.scenario);
	const sites: SourceRange[] = taskLimitSites(ctx.index, id, chain);
	for (const p of free) {
		const site = personLimitSite(ctx.index, p.id, chain);
		if (site) sites.push(site);
	}
	const seen = new Set<string>();
	const causes: Cause[] = [];
	for (const site of sites) {
		const key = `${site.file}:${site.from}`;
		if (seen.has(key)) continue;
		seen.add(key);
		causes.push({ kind: 'limit', site });
	}
	return { causes: causes.length > 0 ? causes : [UNKNOWN], free: true };
}

/** The wait before (ASAP) or after (ALAP) the anchor; `window` is null when the anchor is on the bound. */
export interface Wait {
	readonly bound: Bound;
	readonly window: [Minutes, Minutes] | null;
	readonly causes: readonly Cause[];
	/** People with a busy or leave stretch of their own in the wait (not the project's calendar). */
	readonly held: readonly ResourceId[];
}

export function waitOf(id: TaskId, s: TaskScenarioResult, ctx: ExplainContext, prep: Prep): Wait {
	const alap = s.direction === 'alap';
	const at = alap ? s.end : s.start;
	const bound = boundOf(id, s, ctx, prep);
	if (at === null || bound.bound === null) return { bound, window: null, causes: [], held: [] };
	const [lo, hi] = alap ? [at, bound.bound] : [bound.bound, at];
	if (hi - lo <= 0) {
		const off = lo - hi >= prep.resolution;
		return { bound, window: null, causes: off ? [UNKNOWN] : [], held: [] };
	}
	if (prep.containers.has(id))
		return { bound, window: [lo, hi], causes: [calendarOr(lo, hi, ctx)], held: [] };
	const narrowed = narrowsBooking(ctx.index, id);
	const read = readWindow(id, s, lo, hi, ctx, prep, narrowed);
	const held = new Set<ResourceId>();
	for (const c of narrowed ? [] : read.causes) {
		if ((c.kind === 'busy' || c.kind === 'leave') && c.resource !== null) held.add(c.resource);
	}
	return { bound, window: [lo, hi], causes: read.causes, held: [...held] };
}

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

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The rebalance planner (phase-3.md 6.6, 7.1 W1 and W2; 18.9; ADR-0014 #5). A drop on the heatmap
 * or the lanes to another person or another week becomes one edit intent or one Gantt action. The
 * types and the contract were merged first (T2); T12 adds `planRebalance`. The dry run is in
 * rebalance-check.ts, the drag's axis lock and "Move which task?" in rebalance-drop.ts.
 *
 * ## Contract
 *
 * - `planRebalance(action, ctx)` is pure, as `planAction` is (gantt/intents.ts): it reads the
 *   index, the shown result and its analysis, never applies anything and never schedules. One
 *   drop is one intent or one action: the drag is axis-locked, person or week, not both (18.9).
 * - **`reassign`** becomes `replaceAllocation(task, from, to)`. When `to` is already on the task,
 *   the edit API drops the item, and the label says so ("Dev 3 already works on Login; Dev 1
 *   removed").
 *   - `via-group`: `from` is booked through a group allocation (`allocate team`): "Booked through
 *     Team. Change the task's people in its details."
 *   - `not-a-person`: the drop landed on a group row.
 *   - The edit API's `inherited`, `unsupported-form` (alternatives) and `text-only` come through
 *     unchanged, from the dispatcher's dry run.
 * - **`shift`** becomes Phase 2's `move` action. `days` is the signed number of working days
 *   (project working time) between the two buckets' starts. The dispatcher plans it with
 *   `planAction`, so the move preference (start, gap, or end for ALAP), the clamps and the
 *   one-time constraint warning apply as in R2.
 * - No preview recomputes load: the drop shows a pending ghost until the engine answers (5.2).
 *
 * ## How T12 reads it
 *
 * - The cell details offer "Move to person…" and "Move to week…" for every task of a cell, held
 *   and unmet ones included (`CellTask.movable` governs the drag only), and this planner answers
 *   each. A held or unmet task asked for `from` without being booked in the cell, so it moves like
 *   a booked one.
 * - What the task asks for is read from both sides: the result's v3 `allocate` candidates (after
 *   inheritance, alternatives included) and the text's `allocate` items of the task and its
 *   ancestors (unprefixed or top scenario), so a text edit ahead of the schedule still counts.
 * - **`reassign`**, in order: `same-place` (`from` is `to`); `not-a-person` (`to` is a group, at
 *   its header); `from` named by the task's allocation: the intent; `from` under a group the task
 *   allocates (or `from` that group itself): `via-group`, at the group's `allocate` items, with
 *   the group's id in `group`; `from` a group the task does not allocate: `not-a-person`; anything
 *   else: `not-booked`, at the task's header.
 */
// T12: a `from` that is a group is refused too. A group row's cell lists its members' tasks, and
// a move names the member it takes the work from; from the group itself it would rewrite the
// task's people, which 18.7 sends to the task's details.
// T12: `not-booked` is read as "`from` has nothing to do with the task": neither booked on it in
// the shown result nor asked for by it. A held or unmet task is asked for, so it is not refused.
// `shift` is never `not-booked`: a held or unmet task has no booking in the cell and still moves
// in time; one with no dates is `planAction`'s `not-scheduled`.
// T12: `days`, read as working days counted from the task, not from the bucket starts: the task's
// working day (its snapped start, or for ALAP the day of its snapped end, as R2 anchors a move)
// moved by the bucket offset, to the first working day at or after that day. It equals the count
// between the bucket starts when the two buckets have the same working days before the task's
// day, and keeps the task's weekday when a holiday is in either bucket (the bucket count would
// put a Wednesday task on Tuesday after a Monday holiday in its own week). Without the task's
// dates the bucket starts are counted, as 6.6 says; `planAction` then refuses `not-scheduled`.
// A shift of zero working days (two buckets with no working day between them) is `same-place`.
import type { Minutes } from '../../engine/protocol';
import type { ActionContext, GanttAction, ToastLabel } from '../gantt/intents';
import { scenarioOf } from '../gantt/intents-facts';
import type { WorkingTime } from '../schedule/working-time';
import { rebalanceStrings as S } from '../strings';
import type { EditIntent } from '../tjp/edit/types';
import type { ResourceId, SourceRange, TaskId } from '../tjp/index';

export type RebalanceAction =
	/** W1: to another person. */
	| { type: 'reassign'; task: TaskId; from: ResourceId; to: ResourceId }
	/** W2: to another week. Both are bucket starts, as `BucketAxis.bounds` holds them. */
	| { type: 'shift'; task: TaskId; fromBucket: Minutes; toBucket: Minutes };

// T2: `not-booked` and `same-place` have no sentence in 6.6. Read as: the task has no booking for
// `from` (or in `fromBucket`), and a drop back on its own cell.
export type RebalanceRefusal = 'via-group' | 'not-a-person' | 'not-booked' | 'same-place';

/** What `planRebalance` gives back (6.6 writes the union inline; T2 names it). */
export type RebalancePlan =
	/** `reassign`. */
	| { status: 'intent'; intent: EditIntent; label: ToastLabel }
	/** `shift`: `{ type: 'move', task, days }`. */
	| { status: 'action'; action: GanttAction }
	| {
			status: 'not-possible';
			reason: RebalanceRefusal;
			at: readonly SourceRange[];
			// T12: added (a member, T2's ones unchanged): the sentence names the group ("Booked
			// through Team"), and only the planner knows which group it is.
			/** `via-group`: the group the work is booked through. */
			group?: ResourceId;
	  };

/** T12: `export const planRebalance: PlanRebalanceFn`. */
export type PlanRebalanceFn = (a: RebalanceAction, ctx: ActionContext) => RebalancePlan;

const refuse = (
	reason: RebalanceRefusal,
	at: readonly SourceRange[],
	group?: ResourceId,
): RebalancePlan => ({
	status: 'not-possible',
	reason,
	at,
	...(group === undefined ? {} : { group }),
});

/** A resource with members, in the text or (for one the text does not name) in the result. */
export function isGroup(ctx: Pick<ActionContext, 'index' | 'result'>, id: ResourceId): boolean {
	const sym = ctx.index.resources.get(id);
	if (sym) return sym.children.length > 0;
	return ctx.result?.resources.find((r) => r.id === id)?.group ?? false;
}

function parentOf(ctx: ActionContext, id: ResourceId): ResourceId | null {
	const sym = ctx.index.resources.get(id);
	if (sym) return sym.parent;
	return ctx.result?.resources.find((r) => r.id === id)?.parent ?? null;
}

/** Whether `group` is `id` or one of its ancestors. */
function holds(ctx: ActionContext, group: ResourceId, id: ResourceId): boolean {
	const seen = new Set<ResourceId>();
	for (let r: ResourceId | null = id; r !== null && !seen.has(r); r = parentOf(ctx, r)) {
		if (r === group) return true;
		seen.add(r);
	}
	return false;
}

/** The task and its ancestors in the text (allocations are inherited). */
function lineage(ctx: ActionContext, task: TaskId): Set<TaskId> {
	const up = new Set<TaskId>();
	for (let t: TaskId | null = task; t !== null && !up.has(t);) {
		up.add(t);
		t = ctx.index.tasks.get(t)?.parent ?? null;
	}
	return up;
}

/** The text's `allocate` items of the task and its ancestors, top scenario. */
function textItems(ctx: ActionContext, task: TaskId) {
	const top = ctx.index.scenarios[0]?.id ?? null;
	const up = lineage(ctx, task);
	return ctx.index.allocations.filter(
		(a) =>
			a.task !== null &&
			up.has(a.task) &&
			a.resource !== null &&
			(a.scenario === null || a.scenario === top),
	);
}

/** Every resource the task asks for: result candidates and text items (module comment). */
function asked(ctx: ActionContext, task: TaskId): Set<ResourceId> {
	const out = new Set<ResourceId>();
	for (const item of scenarioOf(ctx.result, task)?.allocate ?? []) {
		for (const c of item.candidates) out.add(c);
	}
	for (const a of textItems(ctx, task)) if (a.resource !== null) out.add(a.resource);
	return out;
}

const nameOf = (ctx: ActionContext, id: ResourceId): string =>
	ctx.index.resources.get(id)?.name ?? ctx.result?.resources.find((r) => r.id === id)?.name ?? id;

const taskName = (ctx: ActionContext, id: TaskId): string => {
	const t = ctx.index.tasks.get(id);
	return t?.name ?? t?.localId ?? id;
};

const taskAt = (ctx: ActionContext, id: TaskId): SourceRange[] => {
	const t = ctx.index.tasks.get(id);
	return t ? [t.decl.header] : [];
};

function planReassign(
	a: Extract<RebalanceAction, { type: 'reassign' }>,
	ctx: ActionContext,
): RebalancePlan {
	const { index } = ctx;
	if (a.from === a.to) return refuse('same-place', []);
	if (isGroup(ctx, a.to)) {
		const sym = index.resources.get(a.to);
		return refuse('not-a-person', sym ? [sym.decl.header] : []);
	}
	const wants = asked(ctx, a.task);
	const fromGroup = isGroup(ctx, a.from);
	if (!fromGroup && wants.has(a.from)) {
		const already = textItems(ctx, a.task).some((x) => x.resource === a.to);
		const [task, from, to] = [taskName(ctx, a.task), nameOf(ctx, a.from), nameOf(ctx, a.to)];
		return {
			status: 'intent',
			intent: { type: 'replaceAllocation', task: a.task, from: a.from, to: a.to },
			label: {
				text: already ? S.label.already(to, task, from) : S.label.reassign(task, from, to),
				approx: false,
			},
		};
	}
	const group = [...wants].find((g) => isGroup(ctx, g) && holds(ctx, g, a.from));
	if (group !== undefined) {
		const items = textItems(ctx, a.task).filter((x) => x.resource === group);
		return refuse(
			'via-group',
			items.length > 0 ? items.map((x) => x.item) : taskAt(ctx, a.task),
			group,
		);
	}
	if (fromGroup) {
		const sym = index.resources.get(a.from);
		return refuse('not-a-person', sym ? [sym.decl.header] : []);
	}
	return refuse('not-booked', taskAt(ctx, a.task));
}

/** Iterations at most when counting working days (a frame of 1,000 years has fewer). */
const MAX_DAYS = 400_000;

/**
 * The signed number of working days from the working day that holds `from` to the first working
 * day at or after the day that holds `to` (`dayStart`, `shiftDays`).
 */
export function workingDaysBetween(wt: WorkingTime, from: Minutes, to: Minutes): number {
	const a = wt.dayStart(from);
	const b = wt.dayStart(to);
	const step = b > a ? 1 : -1;
	let n = 0;
	// Walk day by day until the day reaches `b`; stop where the working days end (no progress).
	for (let m = a; (step > 0 ? m < b : m > b) && Math.abs(n) < MAX_DAYS;) {
		const next = wt.shiftDays(a, n + step, 'start');
		if (step > 0 ? !(next > m) : !(next < m)) break;
		n += step;
		m = next;
	}
	return n;
}

/** The `days` of a shift (module comment, T12). */
export function shiftDaysOf(
	a: Extract<RebalanceAction, { type: 'shift' }>,
	ctx: ActionContext,
): number {
	const delta = a.toBucket - a.fromBucket;
	const wt = ctx.wt;
	if (!wt) return Math.round(delta / 1440);
	const s = scenarioOf(ctx.result, a.task);
	if (!s || s.start === null || s.end === null) {
		return workingDaysBetween(wt, a.fromBucket, a.toBucket);
	}
	// The minute the task's working day is read at: its first working minute, or for ALAP the
	// last working minute before its end (an end instant belongs to the day before it).
	const at = s.direction === 'alap' ? wt.snap(s.end, 'end') - 1 : wt.snap(s.start, 'start');
	return workingDaysBetween(wt, at, at + delta);
}

function planShift(
	a: Extract<RebalanceAction, { type: 'shift' }>,
	ctx: ActionContext,
): RebalancePlan {
	if (a.fromBucket === a.toBucket) return refuse('same-place', []);
	const days = shiftDaysOf(a, ctx);
	if (days === 0) return refuse('same-place', []);
	return { status: 'action', action: { type: 'move', task: a.task, days } };
}

export const planRebalance: PlanRebalanceFn = (a, ctx) =>
	a.type === 'reassign' ? planReassign(a, ctx) : planShift(a, ctx);

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The rebalance planner's types (phase-3.md 6.6, 7.1 W1 and W2; 18.9; ADR-0014 #5). A drop on
 * the heatmap or the lanes to another person or another week becomes one edit intent or one Gantt
 * action. Types and the contract only, merged first (T2); T12 adds `planRebalance` to this
 * module, with the type `PlanRebalanceFn`.
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
 */
import type { Minutes } from '../../engine/protocol';
import type { ActionContext, GanttAction, ToastLabel } from '../gantt/intents';
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
	| { status: 'not-possible'; reason: RebalanceRefusal; at: readonly SourceRange[] };

/** T12: `export const planRebalance: PlanRebalanceFn`. */
export type PlanRebalanceFn = (a: RebalanceAction, ctx: ActionContext) => RebalancePlan;

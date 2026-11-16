// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The rebalance drag's rules that decide what a drop means (phase-3.md 7.2, 18.9), kept pure so
 * that the heatmap and the lanes (T14, T15) share them and the planner's tests cover them:
 *
 * - **Axis lock** (`lockAxis`): once the pointer is past the slop, the drag locks to the axis of
 *   the larger movement: rows change the person (`person`, W1), columns the week (`week`, W2).
 *   It keeps that axis while the pointer moves, even when the other axis grows larger. Going back
 *   over the origin (within the slop of it) unlocks it, and the next move past the slop locks
 *   again.
 * - **One drop, one action** (`dropAction`): the locked axis alone decides the action. A person
 *   drop keeps the bucket and a week drop keeps the person, whatever the other coordinate of the
 *   target cell is; an unlocked drop does nothing.
 * - **"Move which task?"** (`dropTask`): a cell with one movable task drags it; with several, the
 *   drop asks which (`rebalanceStrings.which`); with none, nothing drags. Group rows have no
 *   movable tasks (`CellTask.movable`), and a drop on a group row is the planner's `not-a-person`.
 *
 * Gesture timing (long-press, slop, cancel, auto-scroll) stays in Phase 2's gesture machine
 * (src/lib/gesture/), unchanged: these functions take its offsets in CSS pixels.
 */
// T12: "going back over the origin" is read as coming back within the slop of the drag's start:
// a lock that only crossing the origin's row or column released would trap a drag that went the
// wrong way first.
import type { Minutes } from '../../engine/protocol';
import type { ResourceId, TaskId } from '../tjp/index';
import type { RebalanceAction } from './rebalance';
import type { CellTask } from './types';

export type RebalanceAxis = 'person' | 'week';

/**
 * The axis after a pointer move of (`dx`, `dy`) from the drag's start: `current` while locked and
 * outside the slop, null within it, else the axis of the larger movement (`week` on a tie).
 */
export function lockAxis(
	dx: number,
	dy: number,
	slop: number,
	current: RebalanceAxis | null,
): RebalanceAxis | null {
	const ax = Math.abs(dx);
	const ay = Math.abs(dy);
	if (Math.max(ax, ay) <= slop) return null;
	return current ?? (ay > ax ? 'person' : 'week');
}

/** A heatmap or lane cell: the row's person and the bucket's start (`BucketAxis.bounds`). */
export interface RebalanceCell {
	readonly resource: ResourceId;
	readonly bucket: Minutes;
}

/** The one action a drop of `task` from `origin` on `target` asks for, or null (module comment). */
export function dropAction(
	task: TaskId,
	origin: RebalanceCell,
	target: RebalanceCell,
	axis: RebalanceAxis | null,
): RebalanceAction | null {
	if (axis === 'person')
		return { type: 'reassign', task, from: origin.resource, to: target.resource };
	if (axis === 'week') {
		return { type: 'shift', task, fromBucket: origin.bucket, toBucket: target.bucket };
	}
	return null;
}

export type DropTask =
	| { readonly kind: 'none' }
	| { readonly kind: 'one'; readonly task: TaskId }
	/** "Move which task?": the movable tasks in the cell's order (`LoadModel.cellTasks`). */
	| { readonly kind: 'ask'; readonly tasks: readonly TaskId[] };

/** Which task a drag from a cell with these tasks moves (module comment). */
export function dropTask(cell: readonly CellTask[]): DropTask {
	const tasks = [...new Set(cell.filter((t) => t.movable).map((t) => t.task))];
	if (tasks.length === 0) return { kind: 'none' };
	if (tasks.length === 1) return { kind: 'one', task: tasks[0] as TaskId };
	return { kind: 'ask', tasks };
}

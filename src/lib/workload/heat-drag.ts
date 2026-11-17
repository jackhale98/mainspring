// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The rebalance drag's rules (phase-3.md 7.1 W1 and W2, 7.2, 18.9), pure: which axis a drag
 * locks to, which cell it targets, what a drop would ask for, and what the label by the pointer
 * says. The rules that decide what a drop means are T12's (`lockAxis`, `dropAction`, `dropTask`:
 * rebalance-drop.ts); this builds the heatmap's cells for them. Nothing here edits anything: a drop
 * becomes a `RebalanceAction` for the planner (`planRebalance`, through
 * components/workload/rebalance-adapter.ts), which decides whether it is allowed. The label is a preview of the ask, not of the result (5.2: no preview recomputes
 * load).
 *
 * - **Axis lock.** Once the pointer is past the slop, the drag locks to the axis of the larger
 *   movement: rows change the person (W1), columns change the period (W2). Back inside the slop
 *   of the origin unlocks it. One drop is one intent, never person and week together.
 * - **Targets.** A person drag stays in its column and goes to the row under the pointer; a
 *   period drag stays in its row and goes to the column under it. The pointer is clamped to the
 *   grid, so a drag past an edge targets the last row or column.
 * - **Group rows** are not drop targets (18.9): the label says so and the drop does nothing.
 * - **Which task.** A cell may hold several tasks a drag may start from; the drop then asks which
 *   one (`WhichTask`). One task needs no question.
 */
import type { TaskId } from '../tjp/index';
import { workloadStrings as W } from '../strings';
import type { RebalanceAction } from './rebalance';
import { dropAction, type RebalanceAxis, type RebalanceCell } from './rebalance-drop';
import type { AxisLabels } from './heat-labels';
import type { Cell, HeatLayout } from './heat-layout';
import type { CellTask, LoadModel } from './types';

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** The cell a locked drag targets: same column for a person drag, same row for a week drag. */
export function targetOf(
	axis: RebalanceAxis | null,
	from: Cell,
	x: number,
	y: number,
	l: HeatLayout,
): Cell | null {
	if (axis === null || l.rows === 0 || l.cols === 0) return null;
	if (axis === 'person') {
		return { row: clamp(Math.floor(y / l.rowHeight), 0, l.rows - 1), col: from.col };
	}
	return { row: from.row, col: clamp(Math.floor(x / l.colWidth), 0, l.cols - 1) };
}

/** The tasks of a cell a drag may start from (the model's `movable`, booked only). */
export function movableTasks(model: LoadModel, cell: Cell): readonly CellTask[] {
	return model.cellTasks(cell.row, cell.col).filter((t) => t.kind === 'booked' && t.movable);
}

/** A cell as the planner's drop rules take it (rebalance-drop.ts): the person and the bucket's bounds. */
export function rebalanceCell(model: LoadModel, c: Cell): RebalanceCell | null {
	const row = model.rows[c.row];
	if (!row || c.col < 0 || c.col >= model.axis.count) return null;
	return {
		resource: row.id,
		bucket: model.axis.bounds[c.col] as number,
		bucketEnd: model.axis.bounds[c.col + 1] as number,
	};
}

export interface DragPlan {
	readonly action: RebalanceAction | null;
	/** Whether a drop here would ask for anything (the label is shown either way). */
	readonly ok: boolean;
	readonly label: string;
}

/**
 * What dropping `task` from `from` on `to` asks for, and what to say about it. The action is the
 * planner's own drop rule (`dropAction`, with `toBucketEnd` filled in from the axis); the label is
 * a preview of the ask, and the dry run (`checkRebalance`) says whether the planner allows it.
 */
export function dragPlan(
	model: LoadModel,
	labels: AxisLabels,
	task: TaskId | null,
	from: Cell,
	to: Cell | null,
): DragPlan {
	const none = (label: string): DragPlan => ({ action: null, ok: false, label });
	if (to === null) return none('');
	if (to.row === from.row && to.col === from.col) return none(W.rebalance.sameCell);
	const axis: RebalanceAxis = to.row !== from.row ? 'person' : 'week';
	const target = model.rows[to.row];
	if (!target) return none('');
	if (axis === 'person' && target.group) return none(W.rebalance.dropOnGroup);
	const label =
		axis === 'person'
			? W.rebalance.toPerson(target.name)
			: W.rebalance.toPeriod(labels.period[to.col] ?? '');
	const [origin, end] = [rebalanceCell(model, from), rebalanceCell(model, to)];
	if (task === null || !origin || !end) return { action: null, ok: true, label };
	return { action: dropAction(task, origin, end, axis), ok: true, label };
}

/** The W2 ask for moving `task` from one column to another (the details' menu and the keys). */
export function shiftOf(
	model: LoadModel,
	task: TaskId,
	fromCol: number,
	toCol: number,
): RebalanceAction | null {
	const [origin, end] = [
		rebalanceCell(model, { row: 0, col: fromCol }),
		rebalanceCell(model, { row: 0, col: toCol }),
	];
	return origin && end ? dropAction(task, origin, end, 'week') : null;
}

/** The people (leaf rows) in row order, for the keyboard's person moves. */
export function peopleRows(model: LoadModel): readonly number[] {
	const out: number[] = [];
	model.rows.forEach((r, i) => {
		if (!r.group) out.push(i);
	});
	return out;
}

/**
 * Where an Alt+Up or Alt+Down sequence ends: `offset` people from `row` among the people (groups
 * are skipped), clamped to the first and last. Null for a row that is not a person.
 */
export function personAt(model: LoadModel, row: number, offset: number): number | null {
	const people = peopleRows(model);
	const at = people.indexOf(row);
	if (at < 0) return null;
	return people[clamp(at + offset, 0, people.length - 1)] ?? null;
}

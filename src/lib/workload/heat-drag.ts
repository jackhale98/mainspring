// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The rebalance drag's rules (phase-3.md 7.1 W1 and W2, 7.2, 18.9), pure: which axis a drag
 * locks to, which cell it targets, what a drop would ask for, and what the label by the pointer
 * says. Nothing here edits anything: a drop becomes a `RebalanceAction` for the planner (T12's
 * `planRebalance`, through components/workload/rebalance-adapter.ts), which decides whether it
 * is allowed. The label is a preview of the ask, not of the result (5.2: no preview recomputes
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
import type { ResourceId, TaskId } from '../tjp/index';
import { workloadStrings as W } from '../strings';
import type { RebalanceAction } from './rebalance';
import type { AxisLabels } from './heat-labels';
import type { Cell, HeatLayout } from './heat-layout';
import type { CellTask, LoadModel } from './types';

export type Lock = 'person' | 'period' | null;

/**
 * The lock after the pointer moved (`dx`, `dy` since the press, in content px): none within the
 * slop, else the larger axis the first time past it, then kept until the pointer is back.
 */
export function lockOf(prev: Lock, dx: number, dy: number, slop: number): Lock {
	if (Math.abs(dx) <= slop && Math.abs(dy) <= slop) return null;
	if (prev !== null) return prev;
	return Math.abs(dx) >= Math.abs(dy) ? 'period' : 'person';
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** The cell a locked drag targets: same column for a person drag, same row for a period drag. */
export function targetOf(lock: Lock, from: Cell, x: number, y: number, l: HeatLayout): Cell | null {
	if (lock === null || l.rows === 0 || l.cols === 0) return null;
	if (lock === 'person') {
		return { row: clamp(Math.floor(y / l.rowHeight), 0, l.rows - 1), col: from.col };
	}
	return { row: from.row, col: clamp(Math.floor(x / l.colWidth), 0, l.cols - 1) };
}

/** The tasks of a cell a drag may start from (the model's `movable`, booked only). */
export function movableTasks(model: LoadModel, cell: Cell): readonly CellTask[] {
	return model.cellTasks(cell.row, cell.col).filter((t) => t.kind === 'booked' && t.movable);
}

export interface DragPlan {
	readonly action: RebalanceAction | null;
	/** Whether a drop here would ask for anything (the label is shown either way). */
	readonly ok: boolean;
	readonly label: string;
}

/** What dropping `task` from `from` on `to` asks for, and what to say about it. */
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
	if (to.row !== from.row) {
		const target = model.rows[to.row];
		if (!target) return none('');
		if (target.group) return none(W.rebalance.dropOnGroup);
		const source = model.rows[from.row];
		const label = W.rebalance.toPerson(target.name);
		if (task === null || !source) return { action: null, ok: true, label };
		return {
			action: { type: 'reassign', task, from: source.id as ResourceId, to: target.id },
			ok: true,
			label,
		};
	}
	const label = W.rebalance.toPeriod(labels.period[to.col] ?? '');
	if (task === null) return { action: null, ok: true, label };
	return {
		action: {
			type: 'shift',
			task,
			fromBucket: model.axis.bounds[from.col] as number,
			toBucket: model.axis.bounds[to.col] as number,
		},
		ok: true,
		label,
	};
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

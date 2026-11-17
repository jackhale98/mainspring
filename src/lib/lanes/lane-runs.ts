// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The runs a lane draws (phase-3.md 9.4): a person's bookings as bars, merged per task per day,
 * and their leave as hatched blocks. Pure interval arithmetic over engine data (ADR-0007): the
 * lane never moves a minute of booked time, it only joins slots that belong together to draw them.
 *
 * - **Bars.** A task's booking intervals are joined when the gap between two of them holds no
 *   booking of another task, so a bar never lies over someone else's time (TaskJuggler never
 *   double-books a person, so a lane needs no stacking):
 *     - within one local day the gap is always joined ("merged per task per day": a lunch break or an
 *       hour of free time inside the day is not a gap at lane resolution);
 *     - across days the gap is joined only when it holds no working time and no leave of the person
 *       (a night, a weekend), so a task that runs Monday and Tuesday is one bar, while a free working
 *       day, a day of leave or a day spent on another task between two days of a task splits it.
 * - **Leave.** Each leave type's slots (per working day) are joined across gaps that hold no
 *   working time, so a week of leave is one block, not five.
 *
 * `bridge` is the one joining rule; the day bounds (`BucketAxis.bounds` of a day axis) say where a
 * local day ends. The runs of a person are made once per result and cached by the lane model.
 */
import type { Minutes } from '../../engine/protocol';
import type { TaskId } from '../tjp/index';
import { overlaps } from '../workload/intervals';
import type { IntervalSet } from '../workload/types';

/** One bar of a lane: a task's booked time from `from` to `to`, `minutes` of it booked. */
export interface LaneRun {
	readonly task: TaskId;
	readonly from: Minutes;
	readonly to: Minutes;
	/** Booked minutes inside the run (less than `to - from` over the joined gaps). */
	readonly minutes: number;
}

/** A hatched block of leave: the slots of one type, joined over non-working gaps. */
export interface LeaveRun {
	readonly from: Minutes;
	readonly to: Minutes;
}

/** The index of the day that holds a minute: the last bound at or before it. */
export function dayIndex(dayBounds: Int32Array, m: Minutes): number {
	let lo = 0;
	let hi = dayBounds.length - 2;
	if (hi < 0) return 0;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if ((dayBounds[mid] as number) <= m) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/** Joins each interval of a set to the one before it when `joins` says the gap between them may go. */
export function bridge(
	set: IntervalSet,
	joins: (gapFrom: Minutes, gapTo: Minutes) => boolean,
): Array<[Minutes, Minutes]> {
	const out: Array<[Minutes, Minutes]> = [];
	for (const [s, e] of set) {
		const last = out[out.length - 1];
		if (last && joins(last[1], s)) last[1] = e;
		else out.push([s, e]);
	}
	return out;
}

/**
 * The bars of one person. `tasks` are their bookings per task, `booked` all their bookings merged,
 * `hours` their working time and leave (what a day-spanning bar must not cross), `dayBounds` the
 * local days of the plan.
 */
export function laneRuns(
	tasks: ReadonlyArray<{ readonly task: TaskId; readonly intervals: IntervalSet }>,
	booked: IntervalSet,
	hours: IntervalSet,
	dayBounds: Int32Array,
): LaneRun[] {
	const runs: LaneRun[] = [];
	for (const { task, intervals } of tasks) {
		const joined = bridge(intervals, (a, b) => {
			if (overlaps(booked, a, b)) return false;
			// Within a day, always; across days, only over time the person does not work or take leave.
			return dayIndex(dayBounds, a) === dayIndex(dayBounds, b) || !overlaps(hours, a, b);
		});
		let k = 0;
		for (const [from, to] of joined) {
			// Every interval lies wholly in one run: the run ends where an interval does.
			let minutes = 0;
			while (k < intervals.length && (intervals[k] as readonly [number, number])[0] < to) {
				const [s, e] = intervals[k] as readonly [number, number];
				minutes += e - s;
				k++;
			}
			runs.push({ task, from, to, minutes });
		}
	}
	return runs.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** A person's leave of one type as blocks: slots joined over gaps with no working time. */
export function leaveRuns(leave: IntervalSet, working: IntervalSet): LeaveRun[] {
	return bridge(leave, (a, b) => !overlaps(working, a, b)).map(([from, to]) => ({ from, to }));
}

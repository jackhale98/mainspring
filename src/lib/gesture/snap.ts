// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Snapping glue (phase-2.md 7.2): drag positions snap to working days. The snap function comes
 * from the working-time module (T4, `schedule/working-time.ts`); this file only fixes the
 * interface the gestures need, so the two sides can be built in parallel, and one adapter from
 * `WorkingTime`'s `dayStart` and `dayEnd`.
 *
 * Snapped values are targets for the live label, never schedule results (ADR-0007).
 */
import type { Minutes } from '../../engine/protocol';

/** Which end of a task the minute stands for: a start lands on a day's start, an end on its end. */
export type SnapRole = 'start' | 'end';

/** Maps any minute to the working-day boundary a drag should land on. Pure and idempotent. */
export type SnapFn = (m: Minutes, role: SnapRole) => Minutes;

/** No snapping: whole minutes. For tests and for views with no working time yet. */
export const roundSnap: SnapFn = (m) => Math.round(m);

/**
 * The part of `WorkingTime` (phase-2.md 6.2) the adapter reads. Semantics as documented there:
 * `dayStart(m)` is the first working slot of the working day containing or after `m`;
 * `dayEnd(m)` is the end of the working day containing or before `m`.
 */
export interface WorkingDayBounds {
	dayStart(m: Minutes): Minutes;
	dayEnd(m: Minutes): Minutes;
}

/**
 * Snap to the nearest working-day boundary of the role (ties go to the later one), so a drag of
 * a little over half a day moves a whole day and a drag of a little under does not.
 */
export function snapperFromWorkingTime(wt: WorkingDayBounds): SnapFn {
	const nearest = (m: Minutes, a: Minutes, b: Minutes): Minutes =>
		Math.abs(m - a) < Math.abs(m - b) ? a : b;
	return (m, role) => {
		const at = Math.round(m);
		if (role === 'start') {
			const next = wt.dayStart(at); // this day's start, or the next day's when `at` is off hours
			if (next <= at) {
				const later = wt.dayStart(wt.dayEnd(at)); // the next working day's start
				return nearest(at, next, Math.max(later, next));
			}
			const earlier = wt.dayStart(wt.dayEnd(at) - 1); // the previous working day's start
			return nearest(at, Math.min(earlier, next), next);
		}
		const prev = wt.dayEnd(at); // this day's end, or the previous day's when `at` is off hours
		if (prev >= at) {
			const earlier = wt.dayEnd(wt.dayStart(at) - 1); // the previous working day's end
			return nearest(at, Math.min(earlier, prev), prev);
		}
		const later = wt.dayEnd(wt.dayStart(at)); // the next working day's end
		return nearest(at, prev, Math.max(later, prev));
	};
}

export interface SnappedDelta {
	/** Snapped movement of the dragged edge, in minutes. */
	readonly deltaMin: Minutes;
	/** Where the dragged edge lands. */
	readonly snappedMin: Minutes;
}

/**
 * The snapped movement of an edge that is at `refMin` when the pointer has moved `rawDeltaMin`.
 * The edge snaps, not the pointer. An edge that is off the grid lands on the grid even for a
 * zero movement, so callers treat "back at the origin" as no movement before calling this.
 */
export function snapDelta(
	snap: SnapFn,
	refMin: Minutes,
	rawDeltaMin: Minutes,
	role: SnapRole,
): SnappedDelta {
	const snappedMin = snap(refMin + rawDeltaMin, role);
	return { deltaMin: snappedMin - refMin, snappedMin };
}

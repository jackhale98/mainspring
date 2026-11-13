// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Snapping glue (phase-2.md 6.6, 7.2): drag positions snap to working days. The day arithmetic
 * comes from the working-time module (T4, `schedule/working-time.ts`); this file fixes the small
 * interface the gestures need from it (`WorkingDays`, which `WorkingTime` satisfies) and the
 * `DragSnapper` the controller consumes. It is a branded object, not a bare function, so that
 * `WorkingTime.snap` (a different thing: snap to working *minutes*) cannot be passed by accident.
 *
 * T4 works on local calendar days: `dayStart(m)` is the first working minute of the working day
 * that holds `m` (or the next one when `m` is off a working day) and `shiftDays` walks that day
 * list, so a Monday 22:00 start is on Monday. Everything here goes through `shiftDays`.
 *
 * - A *move* is a whole number of working days, applied with `shiftDays` from the original edge
 *   (the `move` action of 6.6 takes `days`). Zero days leaves the edge exactly where it was, even
 *   mid-day, so a small wiggle never shifts a task.
 * - A *resize* lands on the nearest working-day end, and never on the opposite side of the
 *   original end from where the pointer went.
 *
 * Snapped values are targets for the live label, never schedule results (ADR-0007). The adapter is
 * tested against a stub that mirrors T4's semantics and, since T4 merged, against the real module,
 * which agrees with the stub on every case.
 */
import type { Minutes } from '../../engine/protocol';

export type DayRole = 'start' | 'end';

/** The part of `WorkingTime` the snapping reads (phase-2.md 6.2). */
export interface WorkingDays {
	/** Shift by whole working days (negative allowed), keeping the role: a day's start or end. */
	shiftDays(m: Minutes, days: number, role: DayRole): Minutes;
}

export interface MoveSnap {
	/** Whole working days to move by (what `GanttAction` `move` takes). */
	readonly days: number;
	/** Snapped movement of the edge, in minutes: 0 for zero days, otherwise the shifted edge minus `ref`. */
	readonly deltaMin: Minutes;
	/** Where the edge lands. */
	readonly snappedMin: Minutes;
}
export interface ResizeSnap {
	readonly deltaMin: Minutes;
	readonly snappedMin: Minutes;
}

declare const dragSnapperBrand: unique symbol;
export interface DragSnapper {
	readonly [dragSnapperBrand]: true;
	/** The task edge at `ref` (its start) when the pointer moved `rawDeltaMin` calendar minutes. */
	move(ref: Minutes, rawDeltaMin: Minutes): MoveSnap;
	/** The task end at `ref` when the pointer moved `rawDeltaMin` calendar minutes. */
	resize(ref: Minutes, rawDeltaMin: Minutes): ResizeSnap;
}

const DAY = 1440;
/** Bound on the walk in `snapMoveDays`: more steps than any project has working days. */
const MAX_STEPS = 20000;

/** The working-day boundary of the role nearest to `m` (ties go to the later one). */
export function nearestBoundary(wd: WorkingDays, m: Minutes, role: DayRole): Minutes {
	// shiftDays 0 is the day holding m (or the nearest before or after it), so -1, 0 and +1 always
	// bracket m, whether m is in a working day or in a gap.
	let best = wd.shiftDays(m, 0, role);
	for (const k of [-1, 1]) {
		const c = wd.shiftDays(m, k, role);
		const dc = Math.abs(m - c);
		const db = Math.abs(m - best);
		if (dc < db || (dc === db && c > best)) best = c;
	}
	return best;
}

/**
 * The whole working days nearest to a pointer movement of `rawDeltaMin` calendar minutes, for an
 * edge at `ref`. Weekends make working days uneven in calendar minutes, so the day count is
 * searched (from a good estimate, a step or two) rather than computed.
 */
export function snapMoveDays(wd: WorkingDays, ref: Minutes, rawDeltaMin: Minutes): number {
	if (!Number.isFinite(rawDeltaMin) || rawDeltaMin === 0) return 0;
	const v0 = wd.shiftDays(ref, 0, 'start');
	const off = (k: number): number => wd.shiftDays(ref, k, 'start') - v0;
	let k = Math.round(rawDeltaMin / DAY);
	for (let i = 0; i < 3; i++) {
		const step = Math.round((rawDeltaMin - off(k)) / DAY);
		if (step === 0) break;
		k += step;
	}
	for (let guard = 0; guard < MAX_STEPS; guard++) {
		const here = off(k);
		const gap = Math.abs(rawDeltaMin - here);
		const later = off(k + 1);
		const earlier = off(k - 1);
		if (later !== here && Math.abs(rawDeltaMin - later) <= gap) k++;
		else if (earlier !== here && Math.abs(rawDeltaMin - earlier) < gap) k--;
		else break;
	}
	// Past the end of the frame shiftDays clamps: report the days that actually change something.
	for (let guard = 0; guard < MAX_STEPS && k > 0 && off(k - 1) === off(k); guard++) k--;
	for (let guard = 0; guard < MAX_STEPS && k < 0 && off(k + 1) === off(k); guard++) k++;
	return k === 0 ? 0 : k; // never -0
}

/** Snapping on working days, from the working-time module's `shiftDays`. */
export function dragSnapperFromWorkingDays(wd: WorkingDays): DragSnapper {
	const snapper = {
		move(ref: Minutes, rawDeltaMin: Minutes): MoveSnap {
			const days = snapMoveDays(wd, ref, rawDeltaMin);
			const snappedMin = days === 0 ? ref : wd.shiftDays(ref, days, 'start');
			return { days, deltaMin: snappedMin - ref, snappedMin };
		},
		resize(ref: Minutes, rawDeltaMin: Minutes): ResizeSnap {
			let snappedMin = nearestBoundary(wd, ref + rawDeltaMin, 'end');
			// The edge never goes against the pointer: a mid-day end dragged a little to the left
			// is not snapped to the right, and the other way round.
			if ((rawDeltaMin > 0 && snappedMin < ref) || (rawDeltaMin < 0 && snappedMin > ref)) {
				snappedMin = ref;
			}
			if (rawDeltaMin === 0) snappedMin = ref;
			return { deltaMin: snappedMin - ref, snappedMin };
		},
	};
	return snapper as unknown as DragSnapper;
}

/** Calendar-day snapping, for views with no working time yet and for tests. */
export function calendarDragSnapper(): DragSnapper {
	const snapper = {
		move(ref: Minutes, rawDeltaMin: Minutes): MoveSnap {
			const days = Math.round(rawDeltaMin / DAY) || 0;
			return { days, deltaMin: days * DAY, snappedMin: ref + days * DAY };
		},
		resize(ref: Minutes, rawDeltaMin: Minutes): ResizeSnap {
			const deltaMin = Math.round(rawDeltaMin) || 0;
			return { deltaMin, snappedMin: ref + deltaMin };
		},
	};
	return snapper as unknown as DragSnapper;
}

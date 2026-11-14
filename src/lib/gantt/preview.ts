// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where a dragged bar will land, as the gesture shows it (phase-2.md 7.1, 7.3; ADR-0007): the
 * simple estimate from the engine's dates and the project's working time. It ignores resources,
 * so it is a preview and never a schedule: the bar is drawn as one (hatched, in the pending
 * colour) and the real dates arrive from the engine after the drop. Pure: no edit API runs per
 * pointer move (7.3), only these few lookups in the working time.
 *
 * - A move shifts the task by whole working days (the gesture's snapped `days`). An ASAP task is
 *   held at its start, an ALAP one at its end (the anchor), and the work between them keeps its
 *   length in working time. The shift is clamped by the task's own dependencies: it cannot start
 *   before `earliestStart` (ASAP) or end after `latestEnd` (ALAP) (`clampDays`).
 * - A resize moves the size handle's edge (the end of an ASAP task, the start of an ALAP one) and
 *   never past the anchor: the shortest task is one working day.
 * - Progress snaps to 5 % (R9).
 */
import type { Minutes } from '../../engine/protocol';
import type { WorkingTime } from '../schedule/working-time';
import type { PendingBarState } from '../state/edits-types';
import type { GanttRow } from './model';

/** A bar drawn as a preview or as pending (the overlay paints it, paint/gestures.ts). */
export interface Ghost {
	readonly row: number;
	readonly start: Minutes;
	readonly end: Minutes;
	readonly state: PendingBarState;
	/** The percent complete to draw on it (R9), or null for the task's own. */
	readonly complete: number | null;
	/** Drawn for a drag that cannot be dropped here (a refusal at the start, a bad target). */
	readonly blocked?: boolean;
}

export interface MoveEnv {
	readonly wt: WorkingTime | null;
	readonly row: GanttRow;
	readonly alap: boolean;
	/** `earliestStart(task, ctx)`: an ASAP task's start may not go before it. */
	readonly floor: Minutes | null;
	/** `latestEnd(task, ctx)`: an ALAP task's end may not go after it. */
	readonly ceiling: Minutes | null;
}

const DAY = 1440;

/** The edge a move is measured from: the task's snapped working start. */
export function moveRef(wt: WorkingTime | null, row: GanttRow): Minutes {
	const start = row.start ?? 0;
	return wt ? wt.snap(start, 'start') : start;
}

/** The dragged edge of a resize: the end (ASAP) or the start (ALAP), snapped to working time. */
export function resizeRef(wt: WorkingTime | null, row: GanttRow, alap: boolean): Minutes {
	if (alap) return moveRef(wt, row);
	const end = row.end ?? 0;
	return wt ? wt.snap(end, 'end') : end;
}

/** The new anchor edge of a move by `days`: an ASAP task's start, an ALAP task's end. */
function shifted(env: MoveEnv, days: number): Minutes {
	const { wt, row, alap } = env;
	if (alap) {
		const end = row.end ?? 0;
		return wt ? wt.shiftDays(wt.snap(end, 'end'), days, 'end') : end + days * DAY;
	}
	const start = row.start ?? 0;
	return wt ? wt.shiftDays(wt.snap(start, 'start'), days, 'start') : start + days * DAY;
}

/**
 * The most days toward zero that keep the shifted edge inside the task's dependency limits: an
 * ASAP task back no earlier than `floor`, an ALAP one forward no later than `ceiling`. A move the
 * other way, or on a task with no limit, is as asked.
 */
export function clampDays(env: MoveEnv, days: number): number {
	let d = days;
	const limit = env.alap ? env.ceiling : env.floor;
	if (!env.wt || limit === null) return d;
	const wt = env.wt;
	if (env.alap) {
		// An ALAP task's end is at most the ceiling; the anchor is moved later by positive days.
		const max = wt.snap(limit, 'end');
		while (d > 0 && shifted(env, d) > max) d--;
	} else {
		const min = wt.snap(limit, 'start');
		while (d < 0 && shifted(env, d) < min) d++;
	}
	return d;
}

/** The ghost of a move by `days` (already clamped): start and end in working time. */
export function ghostForMove(env: MoveEnv, days: number, index: number): Ghost {
	const { wt, row, alap } = env;
	const start = row.start ?? 0;
	const end = row.end ?? start;
	const anchor = days === 0 ? (alap ? end : start) : shifted(env, days);
	let a: Minutes;
	let b: Minutes;
	if (!wt) {
		a = alap ? anchor - (end - start) : anchor;
		b = alap ? anchor : anchor + (end - start);
	} else {
		const work = wt.workingBetween(start, end);
		if (alap) {
			b = anchor;
			a = work > 0 ? wt.addWorking(b, -work) : b;
		} else {
			a = anchor;
			b = work > 0 ? wt.addWorking(a, work) : a;
		}
	}
	return { row: index, start: a, end: b, state: 'preview', complete: null };
}

/**
 * The ghost of a resize to `at` (the snapped edge). The anchor stays; the edge is kept at least a
 * working day from it, which is the same clamp the edit API enforces (`at-limit`).
 */
export function ghostForResize(
	wt: WorkingTime | null,
	row: GanttRow,
	alap: boolean,
	at: Minutes,
	index: number,
): Ghost {
	const start = row.start ?? 0;
	const end = row.end ?? start;
	if (alap) {
		const last = wt ? wt.dayStart(Math.max(0, wt.snap(end, 'end') - 1)) : end - DAY;
		return { row: index, start: Math.min(at, last), end, state: 'preview', complete: null };
	}
	const first = wt ? wt.dayEnd(wt.snap(start, 'start')) : start + DAY;
	return { row: index, start, end: Math.max(at, first), state: 'preview', complete: null };
}

/** A resize that reaches no further than where it began, for the "no change" check. */
export function resizeUnchanged(wt: WorkingTime | null, row: GanttRow, alap: boolean, at: Minutes): boolean {
	return at === resizeRef(wt, row, alap);
}

/** The ghost of a progress drag: the bar as it is, with a different share done. */
export function ghostForProgress(row: GanttRow, percent: number, index: number): Ghost {
	return {
		row: index,
		start: row.start ?? 0,
		end: row.end ?? row.start ?? 0,
		state: 'preview',
		complete: percent,
	};
}

/**
 * The days of a move that a key press total asks for, in the preview: the same as `clampDays`, so
 * the keyboard and the pointer show one place.
 */
export const keyDays = (env: MoveEnv, total: number): number => clampDays(env, total);

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * One bar drag as data (phase-2.md 7.1 R1, R2, R9; 7.3): what the gesture controller reports on
 * each pointer move goes in, the ghost and the sentence that hangs by the pointer come out, and
 * at the drop the `GanttAction` and the preview mark for the dispatcher. Pure: nothing here runs
 * the edit API or the engine per move. The one place `planAction` is asked is the label of a
 * resize, and only when the snapped day changes (a few times per drag, no text patch is built).
 *
 * The three modes:
 * - `move` (R2): whole working days, clamped by the task's own dependencies (preview.ts);
 * - `resize-end` (R1): the size handle's edge, snapped to a working day, never past the anchor;
 * - `progress` (R9): 5 % steps along the bar.
 */
import type { Minutes } from '../../engine/protocol';
import type { TimeDelta } from '../gesture/controller';
import type { PendingMark } from '../state/edits-types';
import { gestureStrings } from '../strings';
import type { TaskId } from '../tjp/index';
import type { WorkingTime } from '../schedule/working-time';
import { percentAt, snapPercent } from './handles';
import {
	earliestStart,
	latestEnd,
	planAction,
	refusalMessage,
	resizeEdge,
	type ActionContext,
	type GanttAction,
} from './intents';
import type { GanttLayout, MutableRect } from './layout';
import type { GanttModel, GanttRow } from './model';
import {
	clampDays,
	ghostForMove,
	ghostForProgress,
	ghostForResize,
	resizeRef,
	type Ghost,
	type MoveEnv,
} from './preview';
import { formatMinutes } from './ticks';

export type DragKind = 'move' | 'resize-end' | 'progress';

export interface DragEnv {
	readonly wt: WorkingTime | null;
	readonly model: GanttModel;
	readonly layout: GanttLayout;
	readonly ctx: ActionContext | null;
}

export interface Session {
	readonly kind: DragKind;
	readonly row: number;
	readonly task: TaskId;
	readonly alap: boolean;
	readonly floor: Minutes | null;
	readonly ceiling: Minutes | null;
	/** The move's whole working days, clamped. */
	readonly days: number;
	/** The resize's snapped edge, or null before one moved. */
	readonly at: Minutes | null;
	readonly percent: number | null;
	/** Why the drag cannot drop (the dry run at the start), or null. */
	readonly blocked: string | null;
	readonly ghost: Ghost;
	/** What hangs by the pointer. */
	readonly text: string;
	/** The part of the drag the text and the ghost were made for, to skip the same again. */
	readonly made: string;
}

const dateOf = (env: DragEnv, m: Minutes): string =>
	env.model.calendar ? formatMinutes(env.model.calendar, m) : '';

/** The last day worked is the minute before an end. */
const lastDay = (start: Minutes, end: Minutes): Minutes => Math.max(start, end - 1);

/** Starts a session on a row; null for a row that cannot be dragged (no id, no dates). */
export function beginSession(env: DragEnv, kind: DragKind, row: number): Session | null {
	const r: GanttRow | undefined = env.model.rows[row];
	if (!r?.id || r.start === null || r.end === null) return null;
	const alap = env.ctx ? resizeEdge(r.id, env.ctx) === 'start' : false;
	const base = {
		kind,
		row,
		task: r.id,
		alap,
		floor: env.ctx ? earliestStart(r.id, env.ctx) : null,
		ceiling: env.ctx ? latestEnd(r.id, env.ctx) : null,
		days: 0,
		at: null,
		percent: kind === 'progress' ? snapPercent(r.complete ?? 0) : null,
		blocked: null,
		text: '',
		made: '',
	};
	const ghost: Ghost =
		kind === 'progress'
			? ghostForProgress(r, base.percent ?? 0, row)
			: { row, start: r.start, end: r.end, state: 'preview', complete: null };
	return { ...base, ghost };
}

/** The `MoveEnv` of a session. */
function moveEnv(env: DragEnv, s: Session): MoveEnv {
	return {
		wt: env.wt,
		row: env.model.rows[s.row] as GanttRow,
		alap: s.alap,
		floor: s.floor,
		ceiling: s.ceiling,
	};
}

/** The session after a pointer move, with the ghost and the sentence for where it is now. */
export function advance(
	env: DragEnv,
	s: Session,
	move: { readonly time: TimeDelta | null; readonly atOrigin: boolean; readonly x: number },
): Session {
	const r = env.model.rows[s.row];
	if (!r) return s;
	if (s.kind === 'move') {
		const asked = move.atOrigin ? 0 : (move.time?.days ?? 0);
		const me = moveEnv(env, s);
		const days = clampDays(me, asked);
		if (`m${days}:${asked}` === s.made) return s;
		const ghost = ghostForMove(me, days, s.row);
		const date = dateOf(env, s.alap ? lastDay(ghost.start, ghost.end) : ghost.start);
		const text =
			days === 0 && asked === 0
				? ''
				: days === 0
					? gestureStrings.drag.limit
					: gestureStrings.drag.move(days, date, s.alap);
		return { ...s, days, ghost, text, made: `m${days}:${asked}` };
	}
	if (s.kind === 'resize-end') {
		const ref = resizeRef(env.wt, r, s.alap);
		const at = move.atOrigin ? ref : (move.time?.snappedMin ?? ref);
		if (`r${at}` === s.made) return s;
		const ghost = ghostForResize(env.wt, r, s.alap, at, s.row);
		// What the drop would write: the edit's own label, asked once per snapped day.
		let text = '';
		if (at !== ref && env.ctx) {
			const p = planAction({ type: 'resize', task: s.task, at }, env.ctx);
			const date = dateOf(env, s.alap ? ghost.start : lastDay(ghost.start, ghost.end));
			if (p.status === 'intent') text = gestureStrings.drag.resize(p.label.text, date, s.alap);
			else if (p.status === 'not-possible') {
				text = p.reason === 'at-limit' ? gestureStrings.drag.limit : refusalMessage(p.reason);
			}
		}
		return { ...s, at: at === ref ? null : at, ghost, text, made: `r${at}` };
	}
	const bar: MutableRect = { x: 0, y: 0, w: 0, h: 0 };
	if (!env.layout.barInto(s.row, bar)) return s;
	const percent = move.atOrigin
		? snapPercent(r.complete ?? 0)
		: snapPercent(percentAt(bar, move.x));
	if (`p${percent}` === s.made) return s;
	return {
		...s,
		percent,
		ghost: ghostForProgress(r, percent, s.row),
		text: gestureStrings.drag.progress(percent),
		made: `p${percent}`,
	};
}

/** The same session with the dry run's answer: the ghost is marked, and the sentence says why. */
export function blockedBy(s: Session, message: string | null): Session {
	if (message === s.blocked) return s;
	return {
		...s,
		blocked: message,
		ghost: { ...s.ghost, blocked: message !== null },
		text: message !== null ? gestureStrings.drag.blocked(message) : s.text,
	};
}

/** The action a drag probes at its start, to learn early that the drop would be refused. */
export function probeFor(s: Session, env: DragEnv): GanttAction {
	if (s.kind === 'move') return { type: 'move', task: s.task, days: 1 };
	if (s.kind === 'resize-end') return { type: 'size-step', task: s.task, steps: 1 };
	const now = env.model.rows[s.row]?.complete ?? 0;
	return { type: 'progress', task: s.task, percent: now >= 100 ? 95 : now + 5 };
}

/** What the drop dispatches, and the bar to keep drawn as pending; null when nothing changed. */
export function dropOf(
	s: Session,
	env: DragEnv,
): { readonly action: GanttAction; readonly mark: PendingMark } | null {
	const r = env.model.rows[s.row];
	if (!r) return null;
	if (s.kind === 'move') {
		if (s.days === 0) return null;
		return {
			action: { type: 'move', task: s.task, days: s.days },
			mark: { task: s.task, start: s.ghost.start, end: s.ghost.end },
		};
	}
	if (s.kind === 'resize-end') {
		if (s.at === null) return null;
		// The edge as the ghost shows it: clamped to one working day from the anchor, either way.
		const at = s.alap ? s.ghost.start : s.ghost.end;
		if (at === resizeRef(env.wt, r, s.alap)) return null;
		return {
			action: { type: 'resize', task: s.task, at },
			mark: { task: s.task, start: s.ghost.start, end: s.ghost.end },
		};
	}
	if (s.percent === null || s.percent === snapPercent(r.complete ?? 0)) return null;
	return {
		action: { type: 'progress', task: s.task, percent: s.percent },
		mark: { task: s.task, start: null, end: null, complete: s.percent },
	};
}

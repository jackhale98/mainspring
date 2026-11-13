// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * R2 of intents.ts: moving a task by whole working days, with a `start` (ASAP), an `end` (ALAP)
 * or the gap of its driving dependency (ADR-0008 #2), and the limits its dependencies set.
 *
 * - A move starts from the task's snapped working instant: `snap(start, 'start')` (ASAP) or
 *   `snap(end, 'end')` (ALAP). The engine may place a task in non-working time (after a finish
 *   dependency, on Friday at 17:00); moving that one working day means Tuesday, not Monday,
 *   since its work starts on Monday. "No change" is compared on those snapped instants.
 * - The target is the working day `n` days on (`shiftDays`). A working-time task lands on that
 *   day's first (or, ALAP, last) working minute; a calendar-time one (a milestone, a `duration`)
 *   keeps the engine instant's time of day when that instant is on the day it works.
 * - A gap aims at the same day, at the task's time of day when that is working time there (so a
 *   whole-day gap stays whole), else at the day's first working minute: `T`. `gaplength` is walked over working slots
 *   (TaskScenario#earliestStart counts `gapLength` slots of the project's working time), so it
 *   changes by the working minutes between the old start and `T`: one working day of the plan's
 *   calendar, whatever `dailyworkinghours` says, written in TaskJuggler's `d` units when whole.
 *   `gapduration` is calendar time from the predecessor's end: the fewest (moving later) or most
 *   (moving earlier) whole days that put the successor's work on `T`, else exactly `T - end`.
 *   A dependency with both gaps is not moved (`two-gaps`): one setDependsGap keeps one kind.
 * - When no gap at all lets the task start earlier, an earlier move is `at-limit`.
 */
import type { Minutes, TaskScenarioResult } from '../../engine/protocol';
import { ganttActionStrings as S } from '../strings';
import { headerOf, type TaskFacts } from './intents-facts';
import {
	DAY,
	calendarDates,
	envOf,
	exactText,
	intent,
	notPossible,
	scheduled,
	shown,
	writeDate,
	type DateEnv,
} from './intents-time';
import type { ActionContext, MoveKind, Planned } from './intents';

type At = (id: string) => TaskScenarioResult | null;

/** The anchor a dependency entry leaves from on the other task, or null. */
const anchor = (other: TaskScenarioResult | null, onEnd: boolean): Minutes | null =>
	other ? (onEnd ? other.end : other.start) : null;

/** The latest earliest-start the task's own `depends` entries allow (an ASAP floor), or null. */
export function floorOf(s: TaskScenarioResult, ctx: ActionContext, at: At): Minutes | null {
	const wt = ctx.wt;
	if (!wt) return null;
	let floor: Minutes | null = null;
	for (const d of s.depends) {
		const x = anchor(at(d.task), d.onEnd);
		if (x === null) continue;
		const byLength = d.gapLengthMin > 0 ? wt.addWorking(x, d.gapLengthMin) : x;
		const e = Math.max(byLength, x + d.gapDurationMin);
		if (floor === null || e > floor) floor = e;
	}
	return floor;
}

/** The earliest latest-end the task's own `precedes` entries allow (an ALAP ceiling), or null. */
export function ceilingOf(s: TaskScenarioResult, ctx: ActionContext, at: At): Minutes | null {
	const wt = ctx.wt;
	if (!wt) return null;
	let ceiling: Minutes | null = null;
	for (const d of s.precedes) {
		const y = anchor(at(d.task), d.onEnd);
		if (y === null) continue;
		const byLength = d.gapLengthMin > 0 ? wt.addWorking(y, -d.gapLengthMin) : y;
		const l = Math.min(byLength, y - d.gapDurationMin);
		if (ceiling === null || l < ceiling) ceiling = l;
	}
	return ceiling;
}

/** Whether the task's own text writes a `depends` on `pred` that edits can change. */
const writes = (f: TaskFacts, ctx: ActionContext, pred: string): boolean =>
	ctx.index.dependencies.some(
		(x) => x.form === 'depends' && x.succ === f.id && x.pred === pred && x.textOnly === null,
	);

/**
 * The task's driving `depends` predecessor when its own text writes that dependency, or null. It
 * comes from the driving analysis; without one (still being computed), `local` asks the engine's
 * dates directly: a written entry whose earliest start is the task's working start.
 */
export function writtenDriver(
	f: TaskFacts,
	ctx: ActionContext,
	at: At | null = null,
): string | null {
	if (ctx.analysis) {
		const d = ctx.analysis.driver.get(f.id);
		if (!d || d.kind !== 'dependency' || d.via !== 'depends') return null;
		return writes(f, ctx, d.pred) ? d.pred : null;
	}
	const wt = ctx.wt;
	if (!at || !wt || !scheduled(f)) return null;
	const start = wt.snap(f.s.start as number, 'start');
	for (const d of f.s.depends) {
		const x = anchor(at(d.task), d.onEnd);
		if (x === null || !writes(f, ctx, d.task)) continue;
		const byLength = d.gapLengthMin > 0 ? wt.addWorking(x, d.gapLengthMin) : x;
		if (wt.snap(Math.max(byLength, x + d.gapDurationMin), 'start') === start) return d.task;
	}
	return null;
}

/** The target of a move: `n` working days on from the snapped `base` (module comment). */
function targetOf(
	raw: Minutes,
	base: Minutes,
	n: number,
	role: 'start' | 'end',
	env: DateEnv,
	keepTime: boolean,
): Minutes {
	const wt = env.wt;
	const t = wt.shiftDays(base, n, role);
	if (!keepTime) return t;
	// A calendar-time task keeps the engine instant's time of day when that instant is on the
	// working day it works (Monday 00:00 moves to Tuesday 00:00); one placed outside it (Friday
	// 17:00, working from Monday) lands on the target day's working edge.
	const day = wt.shiftDays(base, 0, role);
	return wt.shiftDays(raw, 0, role) === day ? t + (raw - day) : t;
}

/** R2 with `gap`: the driving dependency's gap, so that the task starts on the target day. */
function planGap(
	f: TaskFacts & { s: TaskScenarioResult },
	pred: string,
	n: number,
	env: DateEnv,
	at: At,
	predName: string,
): Planned {
	const entry = f.s.depends.find((d) => d.task === pred);
	const x = entry ? anchor(at(pred), entry.onEnd) : null;
	if (!entry || x === null) return notPossible('no-driver', f);
	if (entry.gapLengthMin > 0 && entry.gapDurationMin > 0) return notPossible('two-gaps', f);
	const wt = env.wt;
	const base = wt.snap(f.s.start as number, 'start');
	// The same time of day `n` working days on, when that is working time there; else that
	// day's first working minute. Gaps then stay in whole units for a task that starts mid-day.
	const day = wt.shiftDays(base, n, 'start');
	const kept = day + (base - wt.shiftDays(base, 0, 'start'));
	const T = wt.isWorking(kept) ? kept : day;
	const calendar = entry.gapDurationMin > 0;
	const old = calendar ? entry.gapDurationMin : entry.gapLengthMin;
	// Earlier than the predecessor allows with no gap at all: nothing to take away.
	const noGap = wt.snap(x, 'start');
	if (n < 0 && noGap >= base) return notPossible('at-limit', f);
	let min: number;
	if (n < 0 && T <= noGap) min = 0;
	else if (calendar) min = calendarGap(x, T, n, env);
	else min = entry.gapLengthMin + wt.workingBetween(base, T);
	if (min <= 0 && old === 0) return notPossible('at-limit', f);
	if (min === old) return notPossible('at-limit', f);
	const dayMin = calendar ? DAY : Math.round(env.project.dailyWorkingHours * 60);
	const value = min <= 0 ? null : exactText(min, dayMin);
	const kind = calendar ? 'gapduration' : 'gaplength';
	return intent(
		{
			type: 'setDependsGap',
			task: f.id,
			target: pred,
			gap: value === null ? null : { kind, value },
		},
		S.label.gap(f.name, predName, value),
	);
}

/**
 * A `gapduration` from `x` that puts the successor's work on `T`: whole days when some do (the
 * fewest moving later, the most moving earlier), else exactly `T - x`.
 */
function calendarGap(x: Minutes, T: Minutes, n: number, env: DateEnv): number {
	const lands = (k: number): Minutes => env.wt.snap(x + k * DAY, 'start');
	const guess = Math.floor((T - x) / DAY);
	let k: number;
	if (n > 0) {
		k = Math.max(1, guess - 1);
		for (let i = 0; i < 400 && lands(k) < T; i++) k++;
	} else {
		k = Math.max(0, guess + 2);
		for (let i = 0; i < 400 && k > 0 && lands(k) > T; i++) k--;
	}
	return k > 0 && lands(k) === T ? k * DAY : T - x;
}

/** R2: move by whole working days (module comment). */
export function planMove(
	f: TaskFacts,
	days: number,
	kind: MoveKind | undefined,
	ctx: ActionContext,
	at: At,
	nameOf: (id: string) => string,
): Planned {
	if (f.textOnly) return notPossible('text-only', f);
	const env = envOf(ctx, f);
	if (!scheduled(f) || !env) return notPossible('not-scheduled', f);
	const n = Math.trunc(days);
	if (n === 0) return notPossible('at-limit', f);
	if (f.ownStart && f.ownEnd) return notPossible('start-and-end', f);
	const wt = env.wt;
	const exact = calendarDates(f);
	if (f.s.direction === 'alap') {
		if (f.container) return notPossible('container', f);
		const base = wt.snap(f.s.end as number, 'end');
		let end = targetOf(f.s.end as number, base, n, 'end', env, exact);
		const ceiling = ceilingOf(f.s, ctx, at);
		if (ceiling !== null && wt.snap(end, 'end') > wt.snap(ceiling, 'end')) end = ceiling;
		if (wt.snap(end, 'end') === base) return notPossible('at-limit', f);
		const text = writeDate(end, 'end', env, exact);
		if (text === null) return notPossible('at-limit', f);
		const label = S.label.value(
			S.attr.end,
			f.name,
			shown(base, env, true),
			shown(end, env, true),
			false,
		);
		return intent(
			{ type: 'setAttr', task: f.id, attr: 'end', value: text },
			label,
			false,
			!f.ownEnd,
		);
	}
	const pref = kind ?? ctx.move?.kind ?? null;
	if (pref === null) {
		return {
			status: 'ask-move-preference',
			suggested: writtenDriver(f, ctx, at) ? 'gap' : 'start',
		};
	}
	if (pref === 'gap') {
		// Without the analysis the driver is unknown: never fall back to a start constraint then.
		if (!ctx.analysis) return { status: 'not-possible', reason: 'analysing', at: headerOf(f) };
		const driver = writtenDriver(f, ctx);
		if (driver) return planGap(f, driver, n, env, at, nameOf(driver));
		if (kind === 'gap') return notPossible('no-driver', f);
	}
	if (f.container) return notPossible('container', f);
	const base = wt.snap(f.s.start as number, 'start');
	let start = targetOf(f.s.start as number, base, n, 'start', env, exact);
	// A start before the dependencies allow is a schedule error (task_pred_before): clamp.
	const floor = floorOf(f.s, ctx, at);
	if (floor !== null && wt.snap(start, 'start') < wt.snap(floor, 'start')) start = floor;
	if (wt.snap(start, 'start') === base) return notPossible('at-limit', f);
	const text = writeDate(start, 'start', env, exact);
	if (text === null) return notPossible('at-limit', f);
	const label = S.label.value(
		S.attr.start,
		f.name,
		shown(base, env, false),
		shown(start, env, false),
		false,
	);
	return intent(
		{ type: 'setAttr', task: f.id, attr: 'start', value: text },
		label,
		false,
		!f.ownStart,
	);
}

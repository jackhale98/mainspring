// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The time actions of intents.ts: resize and size steps (R1), move (R2) and progress (R9). Every
 * value is a target taken from the engine's dates by whole working days or by the snapped end
 * the gesture gives (ADR-0007): nothing here schedules. The rules are in intents.ts.
 */
import type { Minutes, ProjectInfo, TaskScenarioResult } from '../../engine/protocol';
import { dateText, displayDate } from '../schedule/date-text';
import { durationMinutes, durationText } from '../schedule/duration-text';
import type { WorkingTime } from '../schedule/working-time';
import { ganttActionStrings as S } from '../strings';
import type { EditIntent } from '../tjp/edit/types';
import type { ZoneOffsets } from '../tjp/values/civil';
import type { DurationUnit } from '../tjp/values/duration';
import { allocatedInText, headerOf, type SizingAttr, type TaskFacts } from './intents-facts';
import type { ActionContext, MoveKind, Planned } from './intents';

const DAY = 1440;

/** Planned results that are not intents, shared by the time actions. */
export const notPossible = (
	reason: Extract<Planned, { status: 'not-possible' }>['reason'],
	f: TaskFacts | null = null,
): Planned => ({ status: 'not-possible', reason, at: f ? headerOf(f) : [] });

const intent = (i: EditIntent, text: string, approx = false, constraint = false): Planned => ({
	status: 'intent',
	intent: i,
	label: { text, approx },
	constraint,
});

/** The "HH:MM" of a TaskJuggler date text in minutes, or 0 for a plain date. */
function timeOfDay(text: string): number | null {
	if (text.length === 10) return 0;
	const m = /^\d{4}-\d\d-\d\d-(\d\d):(\d\d)/.exec(text);
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

interface DateEnv {
	readonly project: ProjectInfo;
	readonly zones: ZoneOffsets | undefined;
	readonly wt: WorkingTime;
}

/**
 * Date text for a start (`role` 'start') or an end. A plain date when its midnight means the same
 * working time (the target is that day's first working minute, or the last one before the next
 * midnight) and `exact` is false; the full instant otherwise. Null when it cannot be written.
 */
export function writeDate(
	m: Minutes,
	role: 'start' | 'end',
	env: DateEnv,
	exact: boolean,
): string | null {
	const full = dateText(m, env.project, env.zones);
	if (full === null || full.length === 10 || exact) return full;
	const probe = role === 'start' ? m : m - 1;
	const text = dateText(probe, env.project, env.zones);
	const tod = text === null ? null : timeOfDay(text);
	if (text === null || tod === null) return full;
	const midnight = probe - tod + (role === 'start' ? 0 : DAY);
	const plain = dateText(midnight, env.project, env.zones);
	if (plain === null || plain.length !== 10) return full;
	return env.wt.snap(midnight, role) === m ? plain : full;
}

/** A display date for labels (Intl, the viewer's locale). */
const shown = (m: Minutes, env: DateEnv, end: boolean): string =>
	displayDate(m, env.project, { style: 'weekday', end });

/** Minutes as the smallest of d, h, min that writes them exactly (working days of `dayMin`). */
function exactText(min: number, dayMin: number): string {
	if (min % dayMin === 0) return `${min / dayMin}d`;
	if (min % 60 === 0) return `${min / 60}h`;
	return `${min}min`;
}

/** Whether the task's dates are calendar times (no plain-date shortcut). */
const calendarDates = (f: TaskFacts): boolean => f.milestone || f.sizing?.attr === 'duration';

function scheduled(f: TaskFacts): f is TaskFacts & { s: TaskScenarioResult } {
	return !!f.s?.scheduled && f.s.start !== null && f.s.end !== null;
}

function envOf(ctx: ActionContext, f: TaskFacts): DateEnv | null {
	return ctx.wt && f.project ? { project: f.project, zones: ctx.zones, wt: ctx.wt } : null;
}

/** The value for a size from working or calendar minutes, in `unit` (whole units, at least 1). */
function sizeText(min: number, attr: SizingAttr, unit: DurationUnit, p: ProjectInfo): string {
	return durationText(Math.max(0, min), unit, p, attr);
}

/** R1: the bar's end dragged to `end`. */
export function planResize(f: TaskFacts, end: Minutes, ctx: ActionContext): Planned {
	if (f.textOnly) return notPossible('text-only', f);
	if (f.container) return notPossible('container', f);
	if (f.milestone) return notPossible('milestone', f);
	const env = envOf(ctx, f);
	if (!scheduled(f) || !env) return notPossible('not-scheduled', f);
	const start = f.s.start as number;
	const oldEnd = f.s.end as number;
	if (end <= start || end === oldEnd) return notPossible('at-limit', f);
	const p = env.project;
	const sizing = f.sizing;
	if ((f.ownStart && f.ownEnd) || (!sizing && f.ownEnd)) {
		const text = writeDate(end, 'end', env, calendarDates(f));
		if (text === null) return notPossible('at-limit', f);
		const label = S.label.value(
			S.attr.end,
			f.name,
			shown(oldEnd, env, true),
			shown(end, env, true),
			false,
		);
		return intent({ type: 'setAttr', task: f.id, attr: 'end', value: text }, label);
	}
	const work = env.wt.workingBetween(start, end);
	if (sizing) {
		if (sizing.amount === null || sizing.unit === null) {
			return { status: 'not-possible', reason: 'text-only', at: [sizing.site.statement] };
		}
		const unit = sizing.unit;
		const from = `${sizing.amount}${unit}`;
		let min: number;
		if (sizing.attr === 'effort') {
			const old = durationMinutes(sizing.amount, unit, p, 'effort') ?? 0;
			const span = env.wt.workingBetween(start, oldEnd);
			min = span > 0 ? (old * work) / span : work;
		} else if (sizing.attr === 'length') min = work;
		else min = end - start;
		const value = sizeText(min, sizing.attr, unit, p);
		const approx = sizing.attr === 'effort';
		const label = S.label.value(S.attr[sizing.attr], f.name, from, value, approx);
		return intent({ type: 'setAttr', task: f.id, attr: sizing.attr, value }, label, approx);
	}
	// No size and no end (an open-ended or unsized leaf): effort when someone is booked, else
	// length (18.13). An effort books every allocated person, so it is the span times their number.
	const people = Math.max(f.s.allocated.length, allocatedInText(ctx.index, f.id));
	const attr: SizingAttr = people > 0 ? 'effort' : 'length';
	const value = sizeText(work * Math.max(1, people), attr, 'd', p);
	const approx = attr === 'effort';
	const label = S.label.value(S.attr[attr], f.name, null, value, approx);
	return intent({ type: 'setAttr', task: f.id, attr, value }, label, approx);
}

/** R1 keys: the size by whole written units, or the end by whole working days. */
export function planSizeStep(f: TaskFacts, steps: number, ctx: ActionContext): Planned {
	if (f.textOnly) return notPossible('text-only', f);
	if (f.container) return notPossible('container', f);
	if (f.milestone) return notPossible('milestone', f);
	const n = Math.trunc(steps);
	if (n === 0) return notPossible('at-limit', f);
	const sizing = f.sizing;
	if (sizing && !(f.ownStart && f.ownEnd)) {
		if (sizing.amount === null || sizing.unit === null) {
			return { status: 'not-possible', reason: 'text-only', at: [sizing.site.statement] };
		}
		const next = Math.max(1, Math.round(sizing.amount) + n);
		if (next === sizing.amount) return notPossible('at-limit', f);
		const value = `${next}${sizing.unit}`;
		const label = S.label.value(
			S.attr[sizing.attr],
			f.name,
			`${sizing.amount}${sizing.unit}`,
			value,
			false,
		);
		return intent({ type: 'setAttr', task: f.id, attr: sizing.attr, value }, label);
	}
	if (!scheduled(f) || !ctx.wt) return notPossible('not-scheduled', f);
	return planResize(f, ctx.wt.shiftDays(f.s.end as number, n, 'end'), ctx);
}

/** The latest earliest-start the task's own `depends` entries allow (an ASAP floor), or null. */
export function floorOf(
	s: TaskScenarioResult,
	ctx: ActionContext,
	at: (id: string) => TaskScenarioResult | null,
): Minutes | null {
	const wt = ctx.wt;
	if (!wt) return null;
	let floor: Minutes | null = null;
	for (const d of s.depends) {
		const p = at(d.task);
		const x = p ? (d.onEnd ? p.end : p.start) : null;
		if (x === null || x === undefined) continue;
		const byLength = d.gapLengthMin > 0 ? wt.addWorking(x, d.gapLengthMin) : x;
		const e = Math.max(byLength, x + d.gapDurationMin);
		if (floor === null || e > floor) floor = e;
	}
	return floor;
}

/** The earliest latest-end the task's own `precedes` entries allow (an ALAP ceiling), or null. */
export function ceilingOf(
	s: TaskScenarioResult,
	ctx: ActionContext,
	at: (id: string) => TaskScenarioResult | null,
): Minutes | null {
	const wt = ctx.wt;
	if (!wt) return null;
	let ceiling: Minutes | null = null;
	for (const d of s.precedes) {
		const q = at(d.task);
		const y = q ? (d.onEnd ? q.end : q.start) : null;
		if (y === null || y === undefined) continue;
		const byLength = d.gapLengthMin > 0 ? wt.addWorking(y, -d.gapLengthMin) : y;
		const l = Math.min(byLength, y - d.gapDurationMin);
		if (ceiling === null || l < ceiling) ceiling = l;
	}
	return ceiling;
}

/** The task's driving `depends` predecessor when its own text writes that dependency, or null. */
export function writtenDriver(f: TaskFacts, ctx: ActionContext): string | null {
	const d = ctx.analysis?.driver.get(f.id);
	if (!d || d.kind !== 'dependency' || d.via !== 'depends') return null;
	const written = ctx.index.dependencies.some(
		(x) => x.form === 'depends' && x.succ === f.id && x.pred === d.pred && x.textOnly === null,
	);
	return written ? d.pred : null;
}

/** R2 with `gap`: the driving dependency's gap by whole working days. */
function planGap(
	f: TaskFacts & { s: TaskScenarioResult },
	pred: string,
	days: number,
	env: DateEnv,
	predName: string,
): Planned {
	const entry = f.s.depends.find((d) => d.task === pred);
	if (!entry) return notPossible('no-driver', f);
	const dayMin = Math.round(env.project.dailyWorkingHours * 60);
	const start = f.s.start as number;
	const calendarOnly = entry.gapDurationMin > 0 && entry.gapLengthMin === 0;
	const kind = calendarOnly ? 'gapduration' : 'gaplength';
	const min = calendarOnly
		? entry.gapDurationMin +
			(env.wt.shiftDays(start, days, 'start') - env.wt.shiftDays(start, 0, 'start'))
		: entry.gapLengthMin + days * dayMin;
	const old = calendarOnly ? entry.gapDurationMin : entry.gapLengthMin;
	if (min <= 0 && old === 0) return notPossible('at-limit', f);
	const value = min <= 0 ? null : exactText(min, calendarOnly ? DAY : dayMin);
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

/** R2: move by whole working days. */
export function planMove(
	f: TaskFacts,
	days: number,
	kind: MoveKind | undefined,
	ctx: ActionContext,
	at: (id: string) => TaskScenarioResult | null,
	nameOf: (id: string) => string,
): Planned {
	if (f.textOnly) return notPossible('text-only', f);
	const env = envOf(ctx, f);
	if (!scheduled(f) || !env) return notPossible('not-scheduled', f);
	const n = Math.trunc(days);
	if (n === 0) return notPossible('at-limit', f);
	if (f.ownStart && f.ownEnd) return notPossible('start-and-end', f);
	const exact = calendarDates(f);
	if (f.s.direction === 'alap') {
		if (f.container) return notPossible('container', f);
		const oldEnd = f.s.end as number;
		let end = env.wt.shiftDays(oldEnd, n, 'end');
		const ceiling = ceilingOf(f.s, ctx, at);
		if (ceiling !== null && end > ceiling) end = Math.max(oldEnd, ceiling);
		if (env.wt.snap(end, 'end') === env.wt.snap(oldEnd, 'end')) return notPossible('at-limit', f);
		const text = writeDate(end, 'end', env, exact);
		if (text === null) return notPossible('at-limit', f);
		const label = S.label.value(
			S.attr.end,
			f.name,
			shown(oldEnd, env, true),
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
	const driver = writtenDriver(f, ctx);
	const pref = kind ?? ctx.move?.kind ?? null;
	if (pref === null) return { status: 'ask-move-preference', suggested: driver ? 'gap' : 'start' };
	if (pref === 'gap') {
		if (driver) return planGap(f, driver, n, env, nameOf(driver));
		if (kind === 'gap') return notPossible('no-driver', f);
	}
	if (f.container) return notPossible('container', f);
	const oldStart = f.s.start as number;
	let start = env.wt.shiftDays(oldStart, n, 'start');
	// A start before the dependencies allow is a schedule error (task_pred_before): clamp.
	const floor = floorOf(f.s, ctx, at);
	if (floor !== null && start < floor) start = Math.min(oldStart, floor);
	if (env.wt.snap(start, 'start') === env.wt.snap(oldStart, 'start')) {
		return notPossible('at-limit', f);
	}
	const text = writeDate(start, 'start', env, exact);
	if (text === null) return notPossible('at-limit', f);
	const label = S.label.value(
		S.attr.start,
		f.name,
		shown(oldStart, env, false),
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

/** R9: `complete`, snapped to 5 % in 0..100, leaves only. */
export function planProgress(f: TaskFacts, percent: number): Planned {
	if (f.textOnly) return notPossible('text-only', f);
	if (f.container) return notPossible('container', f);
	if (f.milestone) return notPossible('milestone', f);
	const p = Math.min(
		100,
		Math.max(0, Math.round((Number.isFinite(percent) ? percent : 0) / 5) * 5),
	);
	return intent(
		{ type: 'setAttr', task: f.id, attr: 'complete', value: String(p) },
		S.label.progress(f.name, p),
	);
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The size and date actions of intents.ts: resize and size steps (R1) and progress (R9), and the
 * date text every time action writes. Moves (R2) are in intents-move.ts. Every value is a target
 * taken from the engine's dates by whole working days or by the snapped edge the gesture gives
 * (ADR-0007): nothing here schedules. The rules are in intents.ts.
 *
 * Instants are compared and shifted as working time: an engine date may sit in non-working time
 * (a length task after a finish dependency starts on Friday at 17:00), so a start is first
 * snapped forward to its working minute and an end back to its last one (`WorkingTime.snap`).
 */
import type { Minutes, ProjectInfo, TaskScenarioResult } from '../../engine/protocol';
import { dateText, displayDate } from '../schedule/date-text';
import { durationMinutes, durationText, unitMinutes } from '../schedule/duration-text';
import type { WorkingTime } from '../schedule/working-time';
import { ganttActionStrings as S } from '../strings';
import type { EditIntent } from '../tjp/edit/types';
import type { ZoneOffsets } from '../tjp/values/civil';
import type { DurationUnit } from '../tjp/values/duration';
import { allocatedInText, headerOf, type SizingAttr, type TaskFacts } from './intents-facts';
import type { ActionContext, Planned } from './intents';

export const DAY = 1440;

/** Planned results that are not intents, shared by the time actions. */
export const notPossible = (
	reason: Extract<Planned, { status: 'not-possible' }>['reason'],
	f: TaskFacts | null = null,
): Planned => ({ status: 'not-possible', reason, at: f ? headerOf(f) : [] });

export const intent = (
	i: EditIntent,
	text: string,
	approx = false,
	constraint = false,
): Planned => ({ status: 'intent', intent: i, label: { text, approx }, constraint });

/** The "HH:MM" of a TaskJuggler date text in minutes, or 0 for a plain date. */
function timeOfDay(text: string): number | null {
	if (text.length === 10) return 0;
	const m = /^\d{4}-\d\d-\d\d-(\d\d):(\d\d)/.exec(text);
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export interface DateEnv {
	readonly project: ProjectInfo;
	readonly zones: ZoneOffsets | undefined;
	readonly wt: WorkingTime;
}

/**
 * Date text for a start (`role` 'start') or an end. Unless `exact`, the instant is first snapped
 * to working time, and written as a plain date when that date's midnight means the same working
 * time (the day's first working minute, or the last one before the next midnight); otherwise, and
 * always when `exact`, the full instant. Null when it cannot be written.
 */
export function writeDate(
	at: Minutes,
	role: 'start' | 'end',
	env: DateEnv,
	exact: boolean,
): string | null {
	const m = exact ? at : env.wt.snap(at, role);
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
export const shown = (m: Minutes, env: DateEnv, end: boolean): string =>
	displayDate(m, env.project, { style: 'weekday', end });

/** Minutes as the smallest of d, h, min that writes them exactly (days of `dayMin` minutes). */
export function exactText(min: number, dayMin: number): string {
	if (min % dayMin === 0) return `${min / dayMin}d`;
	if (min % 60 === 0) return `${min / 60}h`;
	return `${min}min`;
}

/** Whether the task's dates are calendar times (no plain-date shortcut, time of day kept). */
export const calendarDates = (f: TaskFacts): boolean =>
	f.milestone || f.sizing?.attr === 'duration';

export function scheduled(f: TaskFacts): f is TaskFacts & { s: TaskScenarioResult } {
	return !!f.s?.scheduled && f.s.start !== null && f.s.end !== null;
}

export function envOf(ctx: ActionContext, f: TaskFacts): DateEnv | null {
	return ctx.wt && f.project ? { project: f.project, zones: ctx.zones, wt: ctx.wt } : null;
}

/** Which edge a task's size handle drags (M2): the end of an ASAP task, the start of an ALAP one. */
export function edgeOf(f: TaskFacts): 'start' | 'end' | null {
	if (f.textOnly || f.container || f.milestone || !scheduled(f)) return null;
	return f.s.direction === 'alap' ? 'start' : 'end';
}

/**
 * An effort for the new span, in the written unit (L1): the whole unit nearest the exact value
 * whose proportional prediction puts the dragged edge on the dragged working day, trying the
 * nearest first and then the other side; exact hours when neither does.
 */
function effortText(
	oldMin: number,
	span: number,
	work: number,
	unit: DurationUnit,
	predicts: (workMin: number) => boolean,
	p: ProjectInfo,
): string {
	const per = unitMinutes(unit, p, 'effort');
	const exact = span > 0 ? (oldMin * work) / span : work;
	if (per === null) return durationText(exact, 'h', p, 'effort');
	const v = exact / per;
	const tries = [...new Set([Math.round(v), Math.floor(v), Math.ceil(v)])].filter((x) => x >= 1);
	for (const x of tries) {
		const min = durationMinutes(x, unit, p, 'effort');
		if (min !== null && predicts(oldMin > 0 ? (span * min) / oldMin : min)) return `${x}${unit}`;
	}
	return durationText(exact, 'h', p, 'effort');
}

/**
 * R1: the size handle dragged to `at` (snapped by the gesture). It is the end of an ASAP task and
 * the start of an ALAP one (`edgeOf`): the other edge, the task's anchor, stays.
 */
export function planResize(f: TaskFacts, at: Minutes, ctx: ActionContext): Planned {
	if (f.textOnly) return notPossible('text-only', f);
	if (f.container) return notPossible('container', f);
	if (f.milestone) return notPossible('milestone', f);
	const env = envOf(ctx, f);
	if (!scheduled(f) || !env) return notPossible('not-scheduled', f);
	const wt = env.wt;
	const p = env.project;
	const start = f.s.start as number;
	const end = f.s.end as number;
	const alap = f.s.direction === 'alap';
	const role = alap ? 'start' : 'end';
	const from = alap ? start : end;
	// The new span, from the fixed anchor to the dragged edge.
	const [a, b] = alap ? [at, end] : [start, at];
	if (b <= a || wt.snap(at, role) === wt.snap(from, role)) return notPossible('at-limit', f);
	const sizing = f.sizing;
	if ((f.ownStart && f.ownEnd) || (!alap && !sizing && f.ownEnd)) {
		const text = writeDate(at, role, env, calendarDates(f));
		if (text === null) return notPossible('at-limit', f);
		const what = alap ? S.attr.start : S.attr.end;
		const label = S.label.value(
			what,
			f.name,
			shown(from, env, !alap),
			shown(at, env, !alap),
			false,
		);
		return intent({ type: 'setAttr', task: f.id, attr: role, value: text }, label);
	}
	const work = wt.workingBetween(a, b);
	const span = wt.workingBetween(start, end);
	// Whether an effort burning over `w` working minutes puts the dragged edge on its day.
	const predicts = (w: number): boolean =>
		alap
			? wt.dayStart(wt.addWorking(end, -Math.round(w))) === wt.dayStart(at)
			: wt.dayEnd(wt.addWorking(start, Math.round(w))) === wt.dayEnd(at);
	if (sizing) {
		if (sizing.amount === null || sizing.unit === null) {
			return { status: 'not-possible', reason: 'text-only', at: [sizing.site.statement] };
		}
		const unit = sizing.unit;
		const old = `${sizing.amount}${unit}`;
		let value: string;
		if (sizing.attr === 'effort') {
			const oldMin = durationMinutes(sizing.amount, unit, p, 'effort') ?? 0;
			value = effortText(oldMin, span, work, unit, predicts, p);
		} else if (sizing.attr === 'length') value = durationText(work, unit, p, 'length');
		else value = durationText(b - a, unit, p, 'duration');
		const approx = sizing.attr === 'effort';
		const label = S.label.value(S.attr[sizing.attr], f.name, old, value, approx);
		return intent({ type: 'setAttr', task: f.id, attr: sizing.attr, value }, label, approx);
	}
	// No size (an open-ended or unsized leaf): effort when someone is booked, else length (18.13).
	// An effort books every allocated person, so it is the span times their number.
	const people = Math.max(f.s.allocated.length, allocatedInText(ctx.index, f.id));
	const attr: SizingAttr = people > 0 ? 'effort' : 'length';
	const value = durationText(work * Math.max(1, people), 'd', p, attr);
	const approx = attr === 'effort';
	const label = S.label.value(S.attr[attr], f.name, null, value, approx);
	return intent({ type: 'setAttr', task: f.id, attr, value }, label, approx);
}

/**
 * R1 keys: the size by whole written units; without a size of its own (or with its own start and
 * end), the handle's edge by whole working days, growing away from the anchor.
 */
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
		const old = `${sizing.amount}${sizing.unit}`;
		const label = S.label.value(S.attr[sizing.attr], f.name, old, value, false);
		return intent({ type: 'setAttr', task: f.id, attr: sizing.attr, value }, label);
	}
	const wt = ctx.wt;
	if (!scheduled(f) || !wt) return notPossible('not-scheduled', f);
	const at =
		f.s.direction === 'alap'
			? wt.shiftDays(wt.snap(f.s.start as number, 'start'), -n, 'start')
			: wt.shiftDays(wt.snap(f.s.end as number, 'end'), n, 'end');
	return planResize(f, at, ctx);
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

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for settings.engine.test.ts: new engine errors of an edited plan, and the narrow
 * predicates that admit an error as depending on the computed schedule. Test-only.
 */
import type { EngineMessage, ScheduleResult } from '../../../engine/protocol';
import type { LinkCorpus } from './links-testing';
import type { EditIntent } from './types';

/** Error and fatal messages of `res` beyond the multiset of ids `base` has. */
export function newErrors(base: ScheduleResult, res: ScheduleResult): EngineMessage[] {
	const left = new Map<string, number>();
	for (const m of base.messages) {
		if (m.level === 'error' || m.level === 'fatal') left.set(m.id, (left.get(m.id) ?? 0) + 1);
	}
	return res.messages.filter((m) => {
		if (m.level !== 'error' && m.level !== 'fatal') return false;
		const n = left.get(m.id) ?? 0;
		if (n > 0) {
			left.set(m.id, n - 1);
			return false;
		}
		return true;
	});
}

/**
 * Intents that can take working time away from tasks: a resource's calendar, efficiency or
 * parent (inherited calendar), the project frame, the project's working hours, daily hours or
 * zone, a removed resource or a leaf made a group.
 */
function takesTime(intent: EditIntent): boolean {
	switch (intent.type) {
		case 'setWorkingHours':
		case 'addLeave':
		case 'updateLeave':
		case 'moveResource':
		case 'deleteResource':
		case 'addResource':
		case 'setProjectHeader':
			return true;
		case 'setResourceAttr':
		case 'removeResourceAttr':
			return intent.attr === 'efficiency';
		case 'setProjectAttr':
		case 'removeProjectAttr':
			return ['dailyworkinghours', 'timezone', 'now'].includes(intent.attr);
		default:
			return false;
	}
}

/** The resource whose calendar an intent changes; null for the project or global scope. */
function calendarOf(intent: EditIntent): string | null | undefined {
	if (intent.type === 'setWorkingHours')
		return intent.scope.kind === 'resource' ? intent.scope.resource : null;
	if (intent.type === 'addLeave')
		return intent.scope.kind === 'resource' ? intent.scope.resource : null;
	return undefined;
}

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Whether a new error depends on the computed schedule or on things the edit API cannot see
 * (logged, not failed), by a narrow predicate per message id:
 * - `sched_runaway` (tasks no longer fit the frame), and `not_scheduled` only next to it
 *   (TaskScenario.rb:446-452 reports both), and `task_pred_before` / `task_succ_after` (a fixed
 *   date can no longer follow or precede a task that now takes longer), for intents that take
 *   working time away;
 * - `booking_no_duty` and `booking_on_vacation` for calendar changes of the booked resource (or
 *   of every resource): bookings are opaque statements the edit API does not read;
 * - `date_in_range` naming today's date for removing `now`: TaskJuggler then reads the clock.
 */
export function scheduleDependent(
	_c: LinkCorpus,
	intent: EditIntent,
	m: EngineMessage,
	all: readonly EngineMessage[] = [],
): boolean {
	switch (m.id) {
		case 'sched_runaway':
		case 'task_pred_before':
		case 'task_succ_after':
			return takesTime(intent);
		case 'not_scheduled':
			return takesTime(intent) && all.some((x) => x.id === 'sched_runaway');
		case 'booking_no_duty':
		case 'booking_on_vacation': {
			const r = calendarOf(intent);
			if (r === undefined) return intent.type === 'updateLeave';
			return r === null || new RegExp(`\\b${r}\\b`).test(m.text);
		}
		case 'date_in_range':
			return intent.type === 'removeProjectAttr' && intent.attr === 'now' && m.text.includes(TODAY);
		default:
			return false;
	}
}

/** The schedules are equal apart from resource and task names. */
export function sameApartFromNames(a: ScheduleResult, b: ScheduleResult): boolean {
	const strip = (r: ScheduleResult): string =>
		JSON.stringify({
			tasks: r.tasks.map((t) => ({ ...t, name: '' })),
			resources: r.resources.map((x) => ({ ...x, name: '' })),
			bookings: r.bookings,
			ok: r.ok,
		});
	return strip(a) === strip(b);
}

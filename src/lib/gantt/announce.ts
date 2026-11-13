// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the Gantt says out loud after a reschedule (phase-2.md 10.1): "Rescheduled. Finish Tue
 * Mar 3, 2 days later. 4 tasks moved." Read from two results of the engine; it counts which
 * tasks changed their start or end and says nothing when nothing changed, so that an edit that
 * leaves the plan where it was does not chatter. Display only (ADR-0007).
 */
import type { ScheduleResult } from '../../engine/protocol';
import { finishOf, finishScenario, formatFinish } from '../schedule/finish';
import { formatDelta } from '../state/status';
import { strings } from '../strings';

const MINUTE_MS = 60_000;

/** The instants a scheduled task starts and ends at, by task id, in the first active scenario. */
function spans(r: ScheduleResult): Map<string, readonly [number, number]> {
	const out = new Map<string, readonly [number, number]>();
	const scenario = finishScenario(r);
	if (scenario === null || r.project === null) return out;
	const origin = Date.parse(r.project.start);
	for (const t of r.tasks) {
		const s = t.scenarios[scenario];
		if (!s?.scheduled || s.start === null || s.end === null) continue;
		out.set(t.id, [origin + s.start * MINUTE_MS, origin + s.end * MINUTE_MS]);
	}
	return out;
}

/**
 * How many tasks scheduled in both results have another start or end in the second. Instants are
 * compared, not minutes, so moving the project start moves every task, which is true in time.
 */
export function tasksMoved(prev: ScheduleResult, next: ScheduleResult): number {
	const before = spans(prev);
	let moved = 0;
	for (const [id, [s, e]] of spans(next)) {
		const was = before.get(id);
		if (was && (was[0] !== s || was[1] !== e)) moved++;
	}
	return moved;
}

/** The sentence for the live region, or null when there is nothing to say. */
export function rescheduleAnnouncement(
	prev: ScheduleResult | null,
	next: ScheduleResult,
	locale?: string,
): string | null {
	if (prev === null || prev === next || prev.revision === next.revision) return null;
	const before = finishOf(prev);
	const after = finishOf(next, before);
	const moved = tasksMoved(prev, next);
	const delta = after?.delta ?? null;
	if (moved === 0 && (delta === null || delta === 0)) return null;
	return strings.gantt.rescheduled(
		after
			? formatFinish(after, locale, { weekday: 'short', day: 'numeric', month: 'short' })
			: null,
		formatDelta(delta, locale),
		moved,
	);
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The one line the toolbar shows for a row, e.g. "Code: Tue, Mar 3, 2026 to Fri, Mar 6, 2026".
 * Display only: dates are written with `Intl` from the engine's minutes, in the project's zone.
 */
import { strings } from '../strings';
import type { GanttModel } from './model';
import { formatMinutes } from './ticks';

export function describeRow(model: GanttModel, index: number | null): string {
	const r = index === null ? undefined : model.rows[index];
	if (!r) return '';
	if (!r.scheduled || r.start === null || r.end === null || !model.calendar) {
		return strings.gantt.unscheduledRow(r.name);
	}
	const from = formatMinutes(model.calendar, r.start);
	const text =
		r.kind === 'milestone'
			? strings.gantt.milestoneOn(r.name, from)
			: // The end is the instant the work stops: the last day worked is the minute before it.
				strings.gantt.span(
					r.name,
					from,
					formatMinutes(model.calendar, Math.max(r.start, r.end - 1)),
				);
	const line = r.people.length > 0 ? strings.gantt.withPeople(text, r.people.join(', ')) : text;
	// Never colour alone (WCAG 1.4.1): a critical row says so.
	return r.critical ? strings.gantt.withCritical(line) : line;
}

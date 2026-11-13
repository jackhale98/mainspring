// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The one line the toolbar shows for a row, e.g. "Code: Tue, Mar 3, 2026 to Fri, Mar 6, 2026".
 * Display only: dates are written with `Intl` from the engine's minutes, in the project's zone.
 * With a driving-path analysis the line ends with the task's float or that it is critical, both
 * labelled as estimates (ADR-0007).
 */
import { unitMinutes } from '../schedule/duration-text';
import { strings } from '../strings';
import type { GanttModel, GanttRow } from './model';
import { formatMinutes } from './ticks';

const E = strings.gantt.estimate;

/** Float in whole working days (whole hours below a day), at least 1: "about 3 working days". */
export function floatAmount(min: number, model: Pick<GanttModel, 'project'>): string {
	const day = model.project ? unitMinutes('d', model.project, 'effort') : null;
	if (day !== null && min >= day) return E.days(Math.max(1, Math.round(min / day)));
	return E.hours(Math.max(1, Math.round(min / 60)));
}

/** The estimate note for a row, or null without an analysis. */
function note(row: GanttRow, model: GanttModel): string | null {
	if (row.critical) return E.critical;
	if (row.floatMin !== null && row.floatMin > 0) return E.float(floatAmount(row.floatMin, model));
	return null;
}

export function describeRow(model: GanttModel, index: number | null): string {
	const r = index === null ? undefined : model.rows[index];
	if (!r) return '';
	if (!r.scheduled || r.start === null || r.end === null || !model.calendar) {
		return strings.gantt.unscheduledRow(r.name);
	}
	const from = formatMinutes(model.calendar, r.start);
	let text =
		r.kind === 'milestone'
			? strings.gantt.milestoneOn(r.name, from)
			: // The end is the instant the work stops: the last day worked is the minute before it.
				strings.gantt.span(
					r.name,
					from,
					formatMinutes(model.calendar, Math.max(r.start, r.end - 1)),
				);
	if (r.people.length > 0) text = strings.gantt.withPeople(text, r.people.join(', '));
	const n = note(r, model);
	return n === null ? text : strings.gantt.withNote(text, n);
}

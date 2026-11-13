// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The one line the toolbar shows for a row, e.g. "Code: Tue, Mar 3, 2026 to Fri, Mar 6, 2026".
 * Display only: dates are written with `Intl` from the engine's minutes, in the project's zone.
 *
 * With a driving-path analysis the line has a note: that the task is critical, or its float, both
 * labelled as estimates (ADR-0007, phase-2.md 6.2.1). The note is the only critical text on the
 * line, so the critical path is never colour alone (WCAG 1.4.1) and never said twice. It is kept
 * apart (`describeRowParts`) so that the toolbar can cut a long line and still show the note.
 */
import { unitMinutes } from '../schedule/duration-text';
import { strings } from '../strings';
import type { GanttModel, GanttRow } from './model';
import { formatMinutes } from './ticks';

const E = strings.gantt.estimate;

export interface RowLine {
	/** The task, its dates and its people; '' for no row. */
	readonly text: string;
	/** The estimate note, or null without one. */
	readonly note: string | null;
}

export const NO_LINE: RowLine = { text: '', note: null };

/** Float in whole working days (whole hours below a day), at least 1: "about 3 working days". */
export function floatAmount(min: number, model: Pick<GanttModel, 'project'>): string {
	const day = model.project ? unitMinutes('d', model.project, 'effort') : null;
	if (day !== null && min >= day) return E.days(Math.max(1, Math.round(min / day)));
	return E.hours(Math.max(1, Math.round(min / 60)));
}

function note(row: GanttRow, model: GanttModel): string | null {
	if (row.critical) return E.critical;
	if (row.floatMin !== null && row.floatMin > 0) return E.float(floatAmount(row.floatMin, model));
	return null;
}

/** The line for a row, with its note apart. */
export function describeRowParts(model: GanttModel, index: number | null): RowLine {
	const r = index === null ? undefined : model.rows[index];
	if (!r) return NO_LINE;
	if (!r.scheduled || r.start === null || r.end === null || !model.calendar) {
		return { text: strings.gantt.unscheduledRow(r.name), note: null };
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
	return { text: line, note: note(r, model) };
}

/** The whole line, note included: what a screen reader hears. */
export function describeRow(model: GanttModel, index: number | null): string {
	const { text, note } = describeRowParts(model, index);
	return note === null ? text : strings.gantt.withNote(text, note);
}

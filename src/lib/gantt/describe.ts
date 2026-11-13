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
	if (r.kind === 'milestone') return strings.gantt.milestoneOn(r.name, from);
	// The end is the instant the work stops: the last day worked is the minute before it.
	return strings.gantt.span(
		r.name,
		from,
		formatMinutes(model.calendar, Math.max(r.start, r.end - 1)),
	);
}

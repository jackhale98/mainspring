// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the lanes say in words (phase-3.md 10): the lane's canvas is aria-hidden, so each period of
 * each person (a cell of the ARIA mirror, at the lanes' zoom) names the tasks booked in it, with
 * their hours and "text only" where the editor cannot move them, after the heatmap's sentence
 * ("Dev 1, week of 9 March: 38 of 40 hours, full"). A group's row is a roll-up and lists no tasks.
 * Sentences are from the strings file.
 */
import { lanesStrings as L } from '../strings-lanes';
import { hoursNumber } from '../workload/heat-cell';
import type { LanesModel } from './lane-model';

/** The most tasks a period names (the rest are "and 3 more" in the details): keeps a name short. */
export const MAX_NAMED = 6;

/** "works on Login 24 h, Report 14 h (text only)" for a person's period, or '' with nothing booked. */
export function laneCellTasks(lanes: LanesModel, row: number, col: number): string {
	const r = lanes.load.rows[row];
	if (!r || r.group) return '';
	const booked = lanes.load.cellTasks(row, col).filter((t) => t.kind === 'booked');
	if (booked.length === 0) return '';
	const named = booked
		.slice(0, MAX_NAMED)
		.map((t) => L.task(lanes.taskName(t.task), hoursNumber(t.minutes), lanes.isTextOnly(t.task)));
	const more = booked.length - named.length;
	return L.assigned(named.join(', ') + (more > 0 ? L.more(more) : ''));
}

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where the today and status-date lines stand against the drawn chart, for the legend and the
 * Today button: each is on the chart, off it (before the first date or after the last), or there
 * is no such date. When the two fall within an hour, as they do for a plan without `now`
 * (phase-2.md 19.17), they are one line, "Today (status date)". Today goes to the first line that
 * is on the chart.
 */
import type { Minutes } from '../../engine/protocol';
import type { GanttModel, LineState } from './model';

export interface MarkerState {
	readonly today: LineState;
	readonly status: LineState;
	readonly merged: boolean;
	/** The minute the Today button goes to; null when no line is on the chart. */
	readonly target: Minutes | null;
}

/** Two lines closer than this are one. */
export const MERGE_WITHIN_MIN = 60;

/**
 * `firstMinute` is the minute at the left edge of the chart (the model's origin and its padding).
 * `todayMin` is the clock, from `todayOf`: the model does not hold it, so that a tick of the clock
 * does not rebuild the model (phase-2.md 6.3).
 */
export function markerState(
	model: GanttModel,
	firstMinute: Minutes,
	todayMin: Minutes | null,
): MarkerState {
	const state = (at: Minutes | null): LineState => {
		if (at === null) return null;
		return at >= firstMinute && at <= model.endMin ? 'on' : 'off';
	};
	const today = state(todayMin);
	const status = state(model.statusMin);
	return {
		today,
		status,
		merged:
			todayMin !== null &&
			model.statusMin !== null &&
			Math.abs(todayMin - model.statusMin) <= MERGE_WITHIN_MIN,
		target: today === 'on' ? todayMin : status === 'on' ? model.statusMin : null,
	};
}

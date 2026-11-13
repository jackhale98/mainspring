// SPDX-License-Identifier: GPL-2.0-or-later
/** Builders for the Gantt unit tests: rows, links and models without an index or an engine. */
import { EMPTY_MODEL, type GanttLink, type GanttModel, type GanttRow } from './model';
import { metricsFor, type Metrics } from './layout';
import { FALLBACK_THEME, type Theme } from './paint/theme';
import { MIN_PER_DAY } from './scale';

export const D = MIN_PER_DAY;

export function row(
	i: number,
	start: number | null,
	end: number | null,
	kind: GanttRow['kind'] = 'task',
	over: Partial<GanttRow> = {},
): GanttRow {
	return {
		key: `task:t${i}`,
		id: `t${i}`,
		node: undefined as never,
		depth: 0,
		name: `Task ${i}`,
		localId: `t${i}`,
		kind,
		expanded: kind === 'container' ? true : null,
		start,
		end,
		scheduled: start !== null,
		allocated: [],
		complete: null,
		people: [],
		peopleIndex: [],
		critical: false,
		floatMin: null,
		lateEnd: null,
		textOnly: null,
		...over,
	};
}

export function link(predRow: number, succRow: number, over: Partial<GanttLink> = {}): GanttLink {
	return {
		pred: `t${predRow}`,
		succ: `t${succRow}`,
		predRow,
		succRow,
		from: 'end',
		to: 'start',
		state: 'declared',
		sites: [],
		gapDurationMin: 0,
		gapLengthMin: 0,
		critical: false,
		...over,
	};
}

export function modelOf(
	rows: GanttRow[],
	links: GanttLink[] = [],
	over: Partial<GanttModel> = {},
): GanttModel {
	const rowOf = new Map(rows.map((r, i) => [r.key, i] as const));
	return { ...EMPTY_MODEL, rows, rowOf, links, endMin: 100 * D, scheduled: true, ...over };
}

/**
 * A fixed theme for the geometry and painter tests, so that they do not move when the tokens do
 * (the look is the tokens' business; the tests check the mechanism).
 */
export const TEST_THEME: Theme = {
	...FALLBACK_THEME,
	rowHeight: 28,
	rowLineWidth: 1,
	barHeight: 16,
	barRadius: 3,
	summaryHeight: 9,
	summaryStem: 5,
	milestoneHalf: 8,
	minBarWidth: 3,
	labelPad: 6,
	linkWidth: 1.25,
	linkWidthCritical: 2,
};

/** The theme a coarse pointer resolves to: the token overrides of tokens.css, in kind. */
export const COARSE_THEME: Theme = {
	...TEST_THEME,
	rowHeight: 40,
	barHeight: 22,
	summaryHeight: 12,
	summaryStem: 7,
	milestoneHalf: 10,
	minBarWidth: 4,
};

export function metricsOf(coarse: boolean): Metrics {
	return metricsFor(coarse ? COARSE_THEME : TEST_THEME, coarse);
}

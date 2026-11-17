// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The lanes' sizes as one object resolved from CSS custom properties (src/styles/tokens.css,
 * `--lane-*`), beside the heatmap's colours (heat-theme.ts) and the Gantt's theme: painters read
 * nothing else, so a token change resizes the lanes with no code change. A lane row is 40 px, the
 * Phase 2 row (phase-3.md 10: the exemption from the 44 px target), and a bar is 22 px high in it.
 */
import type { BucketKind } from '../workload/types';

const NUMBERS = {
	rowHeight: ['--lane-row-height', 40],
	barHeight: ['--lane-bar-height', 22],
	barRadius: ['--lane-bar-radius', 5],
	overHeight: ['--lane-over-height', 6],
	groupHeight: ['--lane-group-height', 10],
	minBar: ['--lane-min-bar', 4],
	colDay: ['--lane-col-day', 56],
	colWeek: ['--lane-col-week', 112],
	colMonth: ['--lane-col-month', 120],
} as const;

export type LaneTheme = { readonly [K in keyof typeof NUMBERS]: number };

function build(get: (name: string) => string): LaneTheme {
	const out: Record<string, number> = {};
	for (const [key, [token, fallback]] of Object.entries(NUMBERS)) {
		const v = Number.parseFloat(get(token));
		out[key] = Number.isFinite(v) && v > 0 ? v : fallback;
	}
	return out as LaneTheme;
}

export const FALLBACK_LANE_THEME: LaneTheme = build(() => '');

export function readLaneTheme(get: (name: string) => string): LaneTheme {
	return build(get);
}

export function laneThemeOf(el: Element): LaneTheme {
	const style = getComputedStyle(el);
	return build((name) => style.getPropertyValue(name));
}

/** The width of a column (a bucket) at a zoom. */
export const laneColWidth = (t: LaneTheme, kind: BucketKind): number =>
	kind === 'day' ? t.colDay : kind === 'week' ? t.colWeek : t.colMonth;

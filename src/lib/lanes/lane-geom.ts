// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The lanes' geometry (phase-3.md 8.1, 9.4), shared by the painter, the hit test and the gestures
 * so that what a pointer hits is what was drawn. Content coordinates, as the heatmap's layout
 * (heat-layout.ts, whose columns the lanes use): x = 0 is the left edge of the first column and a
 * minute is placed inside its column in proportion, so a bar of a week is a week of columns.
 *
 * Inside one lane of `rowHeight` px, from the top: the bars' zone (the row less the over strip), in
 * which a bar is centred, and the over strip at the foot. A group's roll-up band is centred in its
 * row. Pure: sizes in, boxes out.
 */
import type { Minutes } from '../../engine/protocol';
import type { Box, HeatLayout } from '../workload/heat-layout';
import type { BucketAxis } from '../workload/types';
import type { LaneBar } from './lane-model';
import type { LaneTheme } from './lane-theme';

/** The content x of a minute: inside its bucket in proportion, the plot's end for the frame's end. */
export function xOfMinute(layout: HeatLayout, axis: BucketAxis, m: Minutes): number {
	if (layout.cols === 0) return 0;
	return layout.xOfMinute(axis, m) ?? (m < 0 ? 0 : layout.width);
}

/** The zone of a lane the bars (and the leave hatch) use: the row less the over strip. */
export function barZone(layout: HeatLayout, t: LaneTheme, row: number): Box {
	return { x: 0, y: layout.rowTop(row), w: layout.width, h: layout.rowHeight - t.overHeight };
}

/** A bar's box. A bar shorter than `minBar` px keeps that width (it stays visible and hittable). */
export function barBox(
	layout: HeatLayout,
	axis: BucketAxis,
	t: LaneTheme,
	row: number,
	bar: Pick<LaneBar, 'from' | 'to'>,
): Box {
	const zone = barZone(layout, t, row);
	const x = xOfMinute(layout, axis, bar.from);
	const w = Math.max(t.minBar, xOfMinute(layout, axis, bar.to) - x);
	return { x, y: zone.y + (zone.h - t.barHeight) / 2, w, h: t.barHeight };
}

/** A leave block's box: the lane's bar zone, a little inside it. */
export function leaveBox(
	layout: HeatLayout,
	axis: BucketAxis,
	t: LaneTheme,
	row: number,
	run: { readonly from: Minutes; readonly to: Minutes },
): Box {
	const zone = barZone(layout, t, row);
	const x = xOfMinute(layout, axis, run.from);
	return { x, y: zone.y + 2, w: Math.max(2, xOfMinute(layout, axis, run.to) - x), h: zone.h - 3 };
}

/** The over strip under a lane, for the columns [c0, c1). */
export function overBox(
	layout: HeatLayout,
	t: LaneTheme,
	row: number,
	c0: number,
	c1: number,
): Box {
	return {
		x: layout.colLeft(c0),
		y: layout.rowTop(row) + layout.rowHeight - t.overHeight,
		w: (c1 - c0) * layout.colWidth,
		h: t.overHeight,
	};
}

/** A group's roll-up band: thin, centred in its row. */
export function groupBox(
	layout: HeatLayout,
	t: LaneTheme,
	row: number,
	c0: number,
	c1: number,
): Box {
	return {
		x: layout.colLeft(c0),
		y: layout.rowTop(row) + (layout.rowHeight - t.groupHeight) / 2,
		w: (c1 - c0) * layout.colWidth,
		h: t.groupHeight,
	};
}

/**
 * The bars that touch the minutes [lo, hi]: `[first, end)` into runs ordered by start, which do not
 * overlap, so they are ordered by end as well (a binary search for each side).
 */
export function visibleRuns(
	runs: readonly Pick<LaneBar, 'from' | 'to'>[],
	lo: Minutes,
	hi: Minutes,
): readonly [first: number, end: number] {
	let a = 0;
	let b = runs.length;
	while (a < b) {
		const mid = (a + b) >> 1;
		if ((runs[mid] as { to: number }).to <= lo) a = mid + 1;
		else b = mid;
	}
	let end = a;
	let c = runs.length;
	while (end < c) {
		const mid = (end + c) >> 1;
		if ((runs[mid] as { from: number }).from < hi) end = mid + 1;
		else c = mid;
	}
	return [a, end];
}

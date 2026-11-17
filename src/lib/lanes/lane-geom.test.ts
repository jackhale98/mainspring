// SPDX-License-Identifier: GPL-2.0-or-later
// The lanes' geometry (phase-3.md 8.1, 9.4): where a minute, a bar, a leave block, the over strip
// and a group's band stand in a lane, and which bars a window touches.
import { describe, expect, it } from 'vitest';
import { heatLayout } from '../workload/heat-layout';
import type { BucketAxis } from '../workload/types';
import { barBox, barZone, groupBox, leaveBox, overBox, visibleRuns, xOfMinute } from './lane-geom';
import { FALLBACK_LANE_THEME as T } from './lane-theme';

/** Three weeks from minute 0, 10080 minutes each. */
const axis: BucketAxis = {
	kind: 'week',
	bounds: Int32Array.of(0, 10080, 20160, 30240),
	count: 3,
	indexOf: (m) => (m < 0 || m >= 30240 ? -1 : Math.floor(m / 10080)),
};
const layout = heatLayout(4, 3, { rowHeight: T.rowHeight, colWidth: 112 });

describe('lane geometry', () => {
	it('places a minute inside its column in proportion, and the frame end at the right edge', () => {
		expect(xOfMinute(layout, axis, 0)).toBe(0);
		expect(xOfMinute(layout, axis, 5040)).toBe(56);
		expect(xOfMinute(layout, axis, 10080)).toBe(112);
		expect(xOfMinute(layout, axis, 30240)).toBe(layout.width);
	});

	it('centres a bar in the bar zone, the row less the over strip', () => {
		const zone = barZone(layout, T, 1);
		expect(zone).toEqual({ x: 0, y: 40, w: 336, h: 34 });
		const b = barBox(layout, axis, T, 1, { from: 2520, to: 7560 });
		expect(b.x).toBe(28);
		expect(b.w).toBe(56);
		expect(b.h).toBe(T.barHeight);
		expect(b.y).toBe(40 + (34 - T.barHeight) / 2);
	});

	it('keeps a very short bar at the minimum width so that it can be seen and hit', () => {
		expect(barBox(layout, axis, T, 0, { from: 100, to: 130 }).w).toBe(T.minBar);
	});

	it('puts the over strip at the foot of the lane over the columns asked', () => {
		const o = overBox(layout, T, 2, 1, 3);
		expect(o).toEqual({ x: 112, y: 80 + 40 - T.overHeight, w: 224, h: T.overHeight });
	});

	it('draws a group roll-up thin and centred in its row', () => {
		const g = groupBox(layout, T, 0, 0, 2);
		expect(g.h).toBe(T.groupHeight);
		expect(g.y).toBe((40 - T.groupHeight) / 2);
		expect(g.w).toBe(224);
	});

	it('draws a leave block inside the bar zone', () => {
		const b = leaveBox(layout, axis, T, 0, { from: 0, to: 5040 });
		expect(b.x).toBe(0);
		expect(b.w).toBe(56);
		expect(b.y + b.h).toBeLessThanOrEqual(40 - T.overHeight);
	});

	it('finds the bars a window of minutes touches', () => {
		const runs = [
			{ from: 0, to: 100 },
			{ from: 200, to: 300 },
			{ from: 400, to: 500 },
			{ from: 600, to: 700 },
		];
		expect(visibleRuns(runs, 250, 450)).toEqual([1, 3]);
		expect(visibleRuns(runs, 100, 200)).toEqual([1, 1]);
		expect(visibleRuns(runs, 0, 1000)).toEqual([0, 4]);
		expect(visibleRuns(runs, 701, 800)).toEqual([4, 4]);
		expect(visibleRuns([], 0, 10)).toEqual([0, 0]);
	});
});

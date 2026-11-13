// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	MAX_PATH_POINTS,
	bufOf,
	distanceToBuf,
	distanceToSegment,
	newPath,
	pointsOf,
	routeLink,
	type Rect,
} from './route';

const pred: Rect = { x: 0, y: 10, w: 50, h: 16 };
const succ: Rect = { x: 100, y: 38, w: 50, h: 16 };
const ends = { predRow: 0, succRow: 1, from: 'end', to: 'start' } as const;

describe('routeLink', () => {
	it('runs an elbow from the end of one bar to the start of the next, in one buffer', () => {
		const out = newPath();
		routeLink(out, pred, succ, ends, false, 8, 28);
		expect(pointsOf(out)).toEqual([
			{ x: 50, y: 18 },
			{ x: 58, y: 18 },
			{ x: 58, y: 46 },
			{ x: 100, y: 46 },
		]);
		// The buffer is reused: a second route overwrites it, whatever it held.
		routeLink(out, succ, pred, { ...ends, predRow: 1, succRow: 0 }, false, 8, 28);
		expect(out.n).toBeGreaterThan(1);
	});

	it('goes round through the row boundary when the successor starts behind', () => {
		const out = newPath();
		routeLink(out, { ...pred, x: 200 }, { ...succ, x: 10 }, ends, false, 8, 28);
		expect(out.n).toBe(MAX_PATH_POINTS);
		expect(out.xy[5]).toBe(28);
	});

	it('drops straight down from a milestone to a task that starts with it', () => {
		const out = newPath();
		const milestone: Rect = { x: 90, y: 8, w: 20, h: 20 };
		routeLink(out, milestone, { ...succ, x: 100 }, ends, true, 8, 28);
		expect(pointsOf(out)).toEqual([
			{ x: 100, y: 28 },
			{ x: 100, y: 46 },
		]);
	});
});

describe('distances', () => {
	it('measures to a segment and to a buffered path', () => {
		expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
		expect(distanceToSegment(13, 4, 0, 0, 10, 0)).toBe(5);
		expect(distanceToSegment(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2);
		const path = bufOf([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		]);
		expect(distanceToBuf(13, 5, path)).toBe(3);
		expect(distanceToBuf(0, 0, newPath())).toBe(Infinity);
	});
});

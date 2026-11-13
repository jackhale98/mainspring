// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	MAX_PX_PER_DAY,
	MIN_PER_DAY,
	MIN_PX_PER_DAY,
	ZOOM_PRESETS,
	canZoomIn,
	zoomForKey,
	canZoomOut,
	clampZoom,
	createScale,
	nearestLevel,
	scrollAfterZoom,
	zoomIn,
	zoomOut,
} from './scale';

describe('createScale', () => {
	it('maps minutes to pixels and back', () => {
		const s = createScale(48, 1440);
		expect(s.pxPerMin).toBeCloseTo(48 / MIN_PER_DAY);
		expect(s.x(1440)).toBe(0);
		expect(s.x(1440 + MIN_PER_DAY)).toBeCloseTo(48);
		expect(s.m(s.x(5000))).toBeCloseTo(5000);
		expect(s.x(0)).toBeLessThan(0);
	});
});

describe('zoom levels', () => {
	it('snaps a continuous zoom to the nearest named level', () => {
		expect(nearestLevel(60)).toBe('day');
		expect(nearestLevel(14)).toBe('week');
		expect(nearestLevel(5)).toBe('month');
		expect(nearestLevel(1)).toBe('quarter');
	});

	it('steps through the presets and stops at the ends', () => {
		expect(zoomOut(ZOOM_PRESETS.day)).toBe(ZOOM_PRESETS.week);
		expect(zoomOut(ZOOM_PRESETS.week)).toBe(ZOOM_PRESETS.month);
		expect(zoomOut(ZOOM_PRESETS.month)).toBe(ZOOM_PRESETS.quarter);
		expect(zoomOut(ZOOM_PRESETS.quarter)).toBe(ZOOM_PRESETS.quarter);
		expect(zoomIn(ZOOM_PRESETS.quarter)).toBe(ZOOM_PRESETS.month);
		expect(zoomIn(ZOOM_PRESETS.day)).toBe(ZOOM_PRESETS.day);
		expect(canZoomIn(ZOOM_PRESETS.day)).toBe(false);
		expect(canZoomOut(ZOOM_PRESETS.quarter)).toBe(false);
		expect(canZoomIn(ZOOM_PRESETS.week)).toBe(true);
		expect(canZoomOut(ZOOM_PRESETS.week)).toBe(true);
	});

	it('steps from between two presets to the next one in that direction', () => {
		expect(zoomOut(10)).toBe(ZOOM_PRESETS.month);
		expect(zoomIn(10)).toBe(ZOOM_PRESETS.week);
	});

	it('clamps continuous zoom', () => {
		expect(clampZoom(1000)).toBe(MAX_PX_PER_DAY);
		expect(clampZoom(0.01)).toBe(MIN_PX_PER_DAY);
		expect(clampZoom(12)).toBe(12);
	});
});

describe('scrollAfterZoom', () => {
	it('keeps the anchor minute under the same viewport x', () => {
		const to = createScale(56, 0);
		const anchor = 10 * MIN_PER_DAY;
		const scroll = scrollAfterZoom(to, anchor, 300);
		expect(to.x(anchor) - scroll).toBeCloseTo(300);
	});

	it('never scrolls before the start', () => {
		expect(scrollAfterZoom(createScale(56, 0), 0, 300)).toBe(0);
	});
});

describe('zoomForKey', () => {
	const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
		key: k,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		...mods,
	});
	it('zooms in on + and =, out on -, and leaves other keys and the browser zoom alone', () => {
		const week = ZOOM_PRESETS.week;
		expect(zoomForKey(key('+'), week)).toBe(ZOOM_PRESETS.day);
		expect(zoomForKey(key('='), week)).toBe(ZOOM_PRESETS.day);
		expect(zoomForKey(key('-'), week)).toBe(ZOOM_PRESETS.month);
		expect(zoomForKey(key('a'), week)).toBeNull();
		expect(zoomForKey(key('+', { ctrlKey: true }), week)).toBeNull();
		expect(zoomForKey(key('-', { metaKey: true }), week)).toBeNull();
	});
});

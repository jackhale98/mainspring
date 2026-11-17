// SPDX-License-Identifier: GPL-2.0-or-later
// Keyboard movement over the Calendar's days (nav.ts): one day, one week, the ends of the week and of
// the plan, a month, today, and the clamp at the first and last day.
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../engine/timezone';
import { project } from '../schedule/testing';
import { buildGrid } from './grid';
import { between, moveDay, type NavKey } from './nav';

const zones = createTimeZoneHost();
// Monday 2026-01-05 to Sunday 2026-03-01: 56 days.
const g = buildGrid(project(), zones);
const key = (k: string, over: Partial<NavKey> = {}): NavKey => ({
	key: k,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	...over,
});

describe('moveDay', () => {
	it('moves a day, and a week', () => {
		expect(moveDay(g, 10, key('ArrowRight'), null)).toBe(11);
		expect(moveDay(g, 10, key('ArrowLeft'), null)).toBe(9);
		expect(moveDay(g, 10, key('ArrowDown'), null)).toBe(17);
		expect(moveDay(g, 10, key('ArrowUp'), null)).toBe(3);
	});

	it('stops at the first and last day', () => {
		expect(moveDay(g, 0, key('ArrowLeft'), null)).toBe(0);
		expect(moveDay(g, 2, key('ArrowUp'), null)).toBe(0);
		expect(moveDay(g, 55, key('ArrowRight'), null)).toBe(55);
		expect(moveDay(g, 52, key('ArrowDown'), null)).toBe(55);
	});

	it('goes to the ends of the week, Monday first, and of the plan with Ctrl', () => {
		// Day 10 is Thursday 2026-01-15.
		expect(moveDay(g, 10, key('Home'), null)).toBe(7);
		expect(moveDay(g, 10, key('End'), null)).toBe(13);
		expect(moveDay(g, 10, key('Home', { ctrlKey: true }), null)).toBe(0);
		expect(moveDay(g, 10, key('End', { ctrlKey: true }), null)).toBe(55);
	});

	it('keeps the week start of a Sunday-first plan', () => {
		const s = buildGrid(project({ weekStartsMonday: false }), zones);
		// Thursday: Sunday is 4 days back, Saturday 2 ahead.
		expect(moveDay(s, 10, key('Home'), null)).toBe(6);
		expect(moveDay(s, 10, key('End'), null)).toBe(12);
	});

	it('moves a month with the same date, clamped to the shorter month', () => {
		// 2026-01-30 is day 25; PageDown is 2026-02-28 (February has 28 days), day 54.
		expect(moveDay(g, 25, key('PageDown'), null)).toBe(54);
		// 2026-02-10 is day 36; PageUp is 2026-01-10, day 5.
		expect(moveDay(g, 36, key('PageUp'), null)).toBe(5);
		// The first month's PageUp and the last month's PageDown stop at the ends.
		expect(moveDay(g, 3, key('PageUp'), null)).toBe(0);
		expect(moveDay(g, 40, key('PageDown'), null)).toBe(55);
	});

	it('goes to today with T, when there is one', () => {
		expect(moveDay(g, 3, key('t'), 20)).toBe(20);
		expect(moveDay(g, 3, key('T'), 20)).toBe(20);
		expect(moveDay(g, 3, key('t'), null)).toBeNull();
	});

	it('leaves other keys, and Alt and Meta chords, to the caller', () => {
		expect(moveDay(g, 3, key('a'), null)).toBeNull();
		expect(moveDay(g, 3, key('ArrowRight', { altKey: true }), null)).toBeNull();
		expect(moveDay(g, 3, key('ArrowRight', { metaKey: true }), null)).toBeNull();
	});

	it('gives nothing in a plan with no days', () => {
		expect(moveDay(buildGrid(null, zones), 0, key('ArrowRight'), null)).toBeNull();
	});
});

describe('between', () => {
	it('orders two days', () => {
		expect(between(3, 9)).toEqual([3, 9]);
		expect(between(9, 3)).toEqual([3, 9]);
		expect(between(4, 4)).toEqual([4, 4]);
	});
});

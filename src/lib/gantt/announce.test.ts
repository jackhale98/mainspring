// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { at, plan } from '../schedule/testing';
import { RescheduleAnnouncer, rescheduleAnnouncement, tasksMoved } from './announce';

const first = (r: number): ScheduleResult => ({
	...plan([
		['a', { start: at(0, 9), end: at(1, 17) }],
		['b', { start: at(2, 9), end: at(3, 17) }],
		['c', { start: at(4, 9), end: at(4, 17) }],
	]),
	revision: r,
});
const later = (r: number): ScheduleResult => ({
	...plan([
		['a', { start: at(0, 9), end: at(1, 17) }],
		['b', { start: at(4, 9), end: at(5, 17) }],
		['c', { start: at(6, 9), end: at(6, 17) }],
		['d', { start: at(0, 9), end: at(0, 17) }],
	]),
	revision: r,
});

describe('tasksMoved', () => {
	it('counts the tasks that changed their start or end, not new ones', () => {
		expect(tasksMoved(first(1), later(2))).toBe(2);
		expect(tasksMoved(first(1), first(2))).toBe(0);
	});

	it('counts every task when the project start moved', () => {
		const shifted = plan(
			[
				['a', { start: at(0, 9), end: at(1, 17) }],
				['b', { start: at(2, 9), end: at(3, 17) }],
				['c', { start: at(4, 9), end: at(4, 17) }],
			],
			{ start: '2026-01-06T00:00:00Z' },
		);
		expect(tasksMoved(first(1), { ...shifted, revision: 2 })).toBe(3);
	});

	it('ignores a task that is not scheduled', () => {
		const a = plan([['a', { start: null, end: null }]]);
		expect(tasksMoved(a, first(2))).toBe(0);
	});
});

describe('rescheduleAnnouncement', () => {
	it('says the finish, how it changed and how many tasks moved', () => {
		const text = rescheduleAnnouncement(first(1), later(2), 'en-US');
		expect(text).toMatch(
			/^Rescheduled\. Finish [A-Z][a-z]{2}, Jan \d+, 2 days later\. 2 tasks moved\.$/,
		);
	});

	it('says one task in the singular', () => {
		const one = plan([
			['a', { start: at(0, 9), end: at(1, 17) }],
			['b', { start: at(2, 9), end: at(3, 17) }],
			['c', { start: at(5, 9), end: at(5, 17) }],
		]);
		expect(rescheduleAnnouncement(first(1), { ...one, revision: 2 }, 'en-US')).toMatch(
			/1 task moved\.$/,
		);
	});

	it('is silent for the first result, a repeat, and an edit that moved nothing', () => {
		expect(rescheduleAnnouncement(null, first(1))).toBeNull();
		const same = first(1);
		expect(rescheduleAnnouncement(same, same)).toBeNull();
		expect(rescheduleAnnouncement(first(1), first(2))).toBeNull();
	});
});

describe('the announced finish', () => {
	it('is the last day worked, as the End column says, when the end is at midnight', () => {
		const a = plan([['a', { start: at(0, 9), end: 2 * 1440 }]]);
		// Ends at the start of Thursday Jan 8: the last day worked is Wednesday Jan 7.
		const b = plan([['a', { start: at(0, 9), end: 3 * 1440 }]]);
		expect(rescheduleAnnouncement({ ...a, revision: 1 }, { ...b, revision: 2 }, 'en-US')).toMatch(
			/^Rescheduled\. Finish Wed, Jan 7, 1 day later\. 1 task moved\.$/,
		);
	});
});

describe('RescheduleAnnouncer', () => {
	it('says nothing for the first result, then compares each result with the one before', () => {
		const voice = new RescheduleAnnouncer();
		expect(voice.next(first(1), 'en-US')).toBeNull();
		expect(voice.next(later(2), 'en-US')).toMatch(/^Rescheduled\./);
	});

	it('forgets the last result when there is none, so a new plan is not compared with the old', () => {
		const voice = new RescheduleAnnouncer();
		voice.next(first(1), 'en-US');
		expect(voice.next(null)).toBeNull();
		// Another plan, three years later: without the reset this would say "Rescheduled…".
		const other = plan([['x', { start: at(0, 9), end: at(1, 17) }]], {
			start: '2029-01-05T00:00:00Z',
		});
		expect(voice.next({ ...other, revision: 2 }, 'en-US')).toBeNull();
		// And it compares with that plan from then on.
		expect(voice.next(later(3), 'en-US')).not.toBeNull();
	});
});

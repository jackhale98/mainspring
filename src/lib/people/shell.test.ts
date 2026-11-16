// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SEGMENTS, VIEWS } from '../workload/prefs';
import { contentOfSegment, contentOfView, needsPeople, peopleState } from './shell';

describe('what a view or a segment shows', () => {
	it('maps the switcher: Gantt is not a People view, the others show their own content', () => {
		expect(VIEWS.map(contentOfView)).toEqual([null, 'workload', 'resources', 'calendar']);
	});

	it('maps the phone segments: Load is the heatmap, Lanes the lanes, Team the resource list', () => {
		expect(SEGMENTS.map(contentOfSegment)).toEqual(['workload', 'resources', 'calendar', 'team']);
	});

	it('needs people everywhere but the calendar, which holds global holidays', () => {
		expect(needsPeople('workload')).toBe(true);
		expect(needsPeople('resources')).toBe(true);
		expect(needsPeople('team')).toBe(true);
		expect(needsPeople('calendar')).toBe(false);
	});
});

describe('peopleState', () => {
	it('waits for the index before saying anything about the people', () => {
		expect(peopleState('workload', { indexed: false, resources: 0 })).toBe('loading');
		expect(peopleState('calendar', { indexed: false, resources: 3 })).toBe('loading');
	});

	it('shows "No people" for a plan without a resource, except in the calendar', () => {
		for (const c of ['workload', 'resources', 'team'] as const) {
			expect(peopleState(c, { indexed: true, resources: 0 })).toBe('none');
			expect(peopleState(c, { indexed: true, resources: 1 })).toBe('content');
		}
		expect(peopleState('calendar', { indexed: true, resources: 0 })).toBe('content');
	});
});

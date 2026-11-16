// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SEGMENTS, VIEWS } from '../workload/prefs';
import { contentOfSegment, contentOfView } from './shell';

describe('what a view or a segment shows', () => {
	it('maps the switcher: Gantt is not a People view, the others show their own content', () => {
		expect(VIEWS.map(contentOfView)).toEqual([null, 'workload', 'resources', 'calendar']);
	});

	it('maps the phone segments: Load is the heatmap, Lanes the lanes, Team the resource list', () => {
		expect(SEGMENTS.map(contentOfSegment)).toEqual(['workload', 'resources', 'calendar', 'team']);
	});
});

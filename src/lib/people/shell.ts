// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The People shell's pure rules (phase-3.md 9.1, 9.6, 18.10): which content a view of the desktop
 * switcher or a segment of the phone's People tab shows, and when the "No people" state replaces
 * it. The state that remembers the choice is state/people-view.svelte.ts; the components are
 * components/people.
 *
 * - Desktop and tablet: Workload, Resources and Calendar are the views besides the Gantt.
 * - Phone: Load is the heatmap (Workload), Lanes the lanes, Calendar the calendar, and Team the
 *   resource list, which on a desktop is the table beside the lanes (Resources).
 * - What a content shows when the plan has no resource is empty.ts, which only the lazy chunk
 *   imports (a module the frame and the chunk both import would be a chunk of its own, fetched with
 *   the first load).
 */
import type { PeopleSegment, View } from '../state/selection.svelte';

export type PeopleContent = 'workload' | 'resources' | 'calendar' | 'team';

/** The content of a view of the switcher; null for the Gantt, which is not a People view. */
export function contentOfView(view: View): PeopleContent | null {
	return view === 'gantt' ? null : view;
}

export function contentOfSegment(segment: PeopleSegment): PeopleContent {
	switch (segment) {
		case 'load':
			return 'workload';
		case 'lanes':
			return 'resources';
		case 'calendar':
			return 'calendar';
		case 'team':
			return 'team';
	}
}

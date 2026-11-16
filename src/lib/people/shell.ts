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
 * - A plan that declares no resource has nothing to show in Workload, Resources, Lanes or Team:
 *   they show "No people yet" with Add person. The calendar does not need people: holidays are
 *   global ("Everyone", 9.5), so it keeps its own content.
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

/** Whether the content is empty without people (the calendar still holds global holidays). */
export function needsPeople(content: PeopleContent): boolean {
	return content !== 'calendar';
}

/**
 * What the content area shows: nothing yet while the plan has no index, "No people" for a plan that
 * declares no resource, else the content itself.
 */
export function peopleState(
	content: PeopleContent,
	plan: { readonly indexed: boolean; readonly resources: number },
): 'loading' | 'none' | 'content' {
	if (!plan.indexed) return 'loading';
	return needsPeople(content) && plan.resources === 0 ? 'none' : 'content';
}

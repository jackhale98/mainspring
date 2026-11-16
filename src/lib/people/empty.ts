// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * When the "No people" state replaces a People view's content (phase-3.md 9.3, 9.6, 9.8). Imported
 * by the lazy chunk only (shell.ts says why it is apart from the frame's rules).
 *
 * A plan that declares no resource has nothing to show in Workload, Resources, Lanes or Team: they
 * show "No people yet" with Add person. The calendar does not need people: holidays are global
 * ("Everyone", 9.5), so it keeps its own content.
 */
import type { PeopleContent } from './shell';

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

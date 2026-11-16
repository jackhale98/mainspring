// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * People preferences in `localStorage` (phase-3.md 4, 6.7; ADR-0008 #3): which view the visual
 * panel shows (desktop and tablet: Gantt, Workload, Resources, Calendar) and which segment the
 * phone's People tab shows (Load, Lanes, Calendar, Team), each per plan, like the mode and the
 * Gantt's zoom (state/mode.svelte.ts, gantt/prefs.ts). UI preferences only: no plan text is ever
 * stored. Every read and write goes through state/storage.ts, so blocked or full storage, and a
 * value that is not one of the names, mean "no preference" and the defaults apply.
 *
 * The view and the segment are separate preferences: a phone and a desktop share a plan's key but
 * not a screen, and the segments are not the views (Team is the resource list, which the desktop's
 * Resources view shows beside its lanes). Zoom, unit, thresholds and the collapsed groups join
 * here with the heatmap (T14).
 */
import type { PeopleSegment, View } from '../state/selection.svelte';
import { readPref, writePref, type PrefStorage } from '../state/storage';

export const VIEWS: readonly View[] = ['gantt', 'workload', 'resources', 'calendar'];
export const SEGMENTS: readonly PeopleSegment[] = ['load', 'lanes', 'calendar', 'team'];

/** Gantt first: the Gantt is the plan's main view, and the only one a Gantt-first load fetches. */
export const DEFAULT_VIEW: View = 'gantt';
/** The segment a phone's People tab opens on the first time. */
export const DEFAULT_SEGMENT: PeopleSegment = 'load';

export const viewKey = (plan: string): string => `mainspring.view.${plan}`;
export const segmentKey = (plan: string): string => `mainspring.segment.${plan}`;

/** The view a stored (or linked) value names, or null when it names none. */
export function parseView(value: string | null): View | null {
	return VIEWS.find((v) => v === value) ?? null;
}

/** The segment a stored value names, or null when it names none. */
export function parseSegment(value: string | null): PeopleSegment | null {
	return SEGMENTS.find((s) => s === value) ?? null;
}

export function readView(storage: PrefStorage | null, plan: string): View | null {
	return parseView(readPref(storage, viewKey(plan)));
}

export function writeView(storage: PrefStorage | null, plan: string, view: View): void {
	writePref(storage, viewKey(plan), view);
}

export function readSegment(storage: PrefStorage | null, plan: string): PeopleSegment | null {
	return parseSegment(readPref(storage, segmentKey(plan)));
}

export function writeSegment(
	storage: PrefStorage | null,
	plan: string,
	segment: PeopleSegment,
): void {
	writePref(storage, segmentKey(plan), segment);
}

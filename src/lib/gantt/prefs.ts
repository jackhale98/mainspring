// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Gantt preferences in `localStorage` (phase-2.md 4, 18.4, 18.5; ADR-0008 #2 and #3): the move
 * preference, whether its constraint warning was shown, the zoom and the collapsed rows. UI
 * preferences only: no plan text is ever stored. Every read and write goes through storage.ts, so
 * blocked or full storage means "no preference" and the defaults apply.
 *
 * - The move preference is asked once per browser, not once per sample: ADR-0008's consequence
 *   is "The move question appears once per user, not once per drag", and a choice of how moves
 *   change plans is about the user, not the plan. The constraint warning is shown once with it.
 * - Zoom (pixels per day) and the collapsed rows (outline keys) are per sample, like the mode and
 *   the divider (mode.svelte.ts).
 *
 * Plain functions over a `PrefStorage`, for the components to call; the move preference feeds
 * `ActionContext.move` (intents.ts).
 */
import { readPref, writePref, type PrefStorage } from '../state/storage';
import type { MoveKind, MovePreference } from './intents';

export const MOVE_KEY = 'mainspring.gantt.move';
export const MOVE_WARNED_KEY = 'mainspring.gantt.move-warned';
export const zoomKey = (sample: string): string => `mainspring.gantt.zoom.${sample}`;
export const collapseKey = (sample: string): string => `mainspring.gantt.collapsed.${sample}`;

/** Zoom limits in pixels per day, so a stored value can never make the chart unusable. */
export const MIN_PX_PER_DAY = 0.5;
export const MAX_PX_PER_DAY = 400;
/** At most this many collapsed rows are stored (a plan has far fewer containers). */
export const MAX_COLLAPSED = 5000;

const isMoveKind = (s: string | null): s is MoveKind => s === 'start' || s === 'gap';

export function readMovePreference(storage: PrefStorage | null): MovePreference | null {
	const v = readPref(storage, MOVE_KEY);
	return isMoveKind(v) ? { kind: v } : null;
}

export function writeMovePreference(storage: PrefStorage | null, p: MovePreference): void {
	writePref(storage, MOVE_KEY, p.kind);
}

/**
 * Whether to show the "a fixed start is a constraint" warning now (ADR-0008 #2): once, the first
 * time an edit adds a `start` or `end` (`Planned.constraint`). Marks it shown.
 */
export function takeConstraintWarning(storage: PrefStorage | null): boolean {
	if (readPref(storage, MOVE_WARNED_KEY) === '1') return false;
	writePref(storage, MOVE_WARNED_KEY, '1');
	return true;
}

export function readZoom(storage: PrefStorage | null, sample: string): number | null {
	const v = Number(readPref(storage, zoomKey(sample)) ?? NaN);
	return Number.isFinite(v) && v >= MIN_PX_PER_DAY && v <= MAX_PX_PER_DAY ? v : null;
}

export function writeZoom(storage: PrefStorage | null, sample: string, pxPerDay: number): void {
	if (!Number.isFinite(pxPerDay)) return;
	const v = Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, pxPerDay));
	writePref(storage, zoomKey(sample), String(v));
}

/** The collapsed outline keys, or an empty set when nothing (or nothing valid) is stored. */
export function readCollapsed(storage: PrefStorage | null, sample: string): Set<string> {
	const raw = readPref(storage, collapseKey(sample));
	if (raw === null) return new Set();
	try {
		const v: unknown = JSON.parse(raw);
		if (!Array.isArray(v)) return new Set();
		return new Set(v.filter((x): x is string => typeof x === 'string').slice(0, MAX_COLLAPSED));
	} catch {
		return new Set();
	}
}

export function writeCollapsed(
	storage: PrefStorage | null,
	sample: string,
	keys: ReadonlySet<string>,
): void {
	writePref(storage, collapseKey(sample), JSON.stringify([...keys].slice(0, MAX_COLLAPSED)));
}

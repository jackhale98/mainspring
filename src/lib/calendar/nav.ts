// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Keyboard movement over the Calendar's days (phase-3.md 7.1 W3 to W5, 10): the grid pattern on a
 * run of consecutive days, so ArrowLeft and ArrowRight are one day, ArrowUp and ArrowDown one
 * week, Home and End the ends of the week, PageUp and PageDown a month, Ctrl+Home and Ctrl+End the
 * ends of the plan, and T today. With Shift the same moves extend the selection (the caller keeps
 * the anchor). A move never leaves the frame: it stops at the first and last day.
 *
 * Pure: it reads the grid and returns the day to move to, or null for a key it does not own.
 */
import type { CalendarGrid } from './grid';

export interface NavKey {
	readonly key: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
}

const clamp = (i: number, n: number): number => Math.max(0, Math.min(n - 1, i));

/** The day to move to from `from`, or null when the key is not a move. `today` is a day or null. */
export function moveDay(
	grid: CalendarGrid,
	from: number,
	k: NavKey,
	today: number | null,
): number | null {
	const n = grid.days.length;
	const here = grid.days[from];
	if (n === 0 || !here || k.altKey || k.metaKey) return null;
	const first = grid.weekStartsMonday ? 1 : 0;
	const col = (here.weekday - first + 7) % 7;
	switch (k.key) {
		case 'ArrowLeft':
			return clamp(from - 1, n);
		case 'ArrowRight':
			return clamp(from + 1, n);
		case 'ArrowUp':
			return clamp(from - 7, n);
		case 'ArrowDown':
			return clamp(from + 7, n);
		case 'Home':
			return k.ctrlKey ? 0 : clamp(from - col, n);
		case 'End':
			return k.ctrlKey ? n - 1 : clamp(from + (6 - col), n);
		case 'PageUp':
		case 'PageDown': {
			const m = grid.monthOf(from);
			const at = grid.months[m + (k.key === 'PageUp' ? -1 : 1)];
			if (!at) return clamp(k.key === 'PageUp' ? 0 : n - 1, n);
			return clamp(at.base + Math.min(here.date, at.length) - 1, n);
		}
		case 't':
		case 'T':
			return k.ctrlKey || today === null ? null : today;
		default:
			return null;
	}
}

/** The days between two (either order), as `[lo, hi]`. */
export const between = (a: number, b: number): readonly [number, number] =>
	a <= b ? [a, b] : [b, a];

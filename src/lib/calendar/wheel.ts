// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A wheel or trackpad scroll over the month that fills the view changes the month, once per
 * gesture (phase-3.md 22.x, amended 2026-11-17). A trackpad sends dozens of events for one swipe
 * and keeps going for a second on inertia, so a month is not one event: a gesture is a run of
 * events with no gap of `quietMs` between them, and it moves the month once, when its distance
 * passes `threshold`. Events after that, inertia included, change nothing until the wheel has been
 * still for `quietMs`. A wheel's notch (about 100 px) passes the default threshold alone.
 *
 * Pure but for its own small state: the caller gives each event's delta and time.
 */

export interface WheelPager {
	/** The month step for one event: -1 (earlier), 1 (later) or 0. `dy` is in px (see `wheelPx`). */
	push(dy: number, t: number): -1 | 0 | 1;
	reset(): void;
}

export const WHEEL_THRESHOLD = 60;
export const WHEEL_QUIET_MS = 180;

export function createWheelPager(
	threshold = WHEEL_THRESHOLD,
	quietMs = WHEEL_QUIET_MS,
): WheelPager {
	let sum = 0;
	let last = Number.NEGATIVE_INFINITY;
	let spent = false;
	return {
		push(dy, t) {
			if (t - last > quietMs) {
				sum = 0;
				spent = false;
			}
			last = t;
			if (spent) return 0;
			sum += dy;
			if (Math.abs(sum) < threshold) return 0;
			spent = true;
			return sum < 0 ? -1 : 1;
		},
		reset() {
			sum = 0;
			last = Number.NEGATIVE_INFINITY;
			spent = false;
		},
	};
}

/** A wheel event's vertical delta in px: a line is 16 px, a page is the view's height. */
export const wheelPx = (dy: number, mode: number, pageHeight: number): number =>
	mode === 1 ? dy * 16 : mode === 2 ? dy * pageHeight : dy;

// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A wheel or trackpad scroll over the month that fills the view changes the month, once per
 * gesture (phase-3.md 22.x, amended 2026-11-17). A trackpad sends dozens of events for one swipe
 * and keeps going for a second on inertia, so a month is not one event: a gesture is a run of
 * events with no gap of `quietMs` between them, and it moves the month once, when its distance
 * passes `threshold`. Events after that, inertia included, change nothing until the wheel has been
 * still for `quietMs`.
 *
 * - A mouse wheel's notch is a full step: in pixels (about 100) it passes the threshold alone, and
 *   a notch counted in lines or pages (`wheelPx`) is a full step by definition.
 * - Slow small ticks (a high-resolution wheel turned gently) add up: a sum that has not paged is
 *   kept for `accumMs`, longer than the stillness that ends a gesture, so they page once they pass
 *   the threshold.
 *
 * Pure but for its own small state: the caller gives each event's delta and time.
 */

export interface WheelPager {
	/** The month step for one event: -1 (earlier), 1 (later) or 0. `dy` is in px (see `wheelPx`). */
	push(dy: number, t: number): -1 | 0 | 1;
	reset(): void;
}

export const WHEEL_THRESHOLD = 60;
/** The stillness that ends a gesture that has paged. */
export const WHEEL_QUIET_MS = 180;
/** How long a sum that has not paged yet is kept while the wheel is idle. */
export const WHEEL_ACCUM_MS = 450;

export function createWheelPager(
	threshold = WHEEL_THRESHOLD,
	quietMs = WHEEL_QUIET_MS,
	accumMs = WHEEL_ACCUM_MS,
): WheelPager {
	let sum = 0;
	let last = Number.NEGATIVE_INFINITY;
	let spent = false;
	return {
		push(dy, t) {
			if (t - last > (spent ? quietMs : accumMs)) {
				sum = 0;
				spent = false;
			}
			last = t;
			if (spent) return 0;
			// A turn the other way starts the sum again.
			if (sum !== 0 && Math.sign(sum) !== Math.sign(dy)) sum = 0;
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

/**
 * A wheel event's vertical delta in px. A notch in lines or pages (`deltaMode` 1 or 2) is a full
 * step whatever its size: Firefox and some mice report 3 lines, not 100 px.
 */
export const wheelPx = (dy: number, mode: number): number =>
	mode === 0 ? dy : Math.sign(dy) * WHEEL_THRESHOLD;

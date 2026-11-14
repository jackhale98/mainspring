// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Lets the frame after a drop paint before the edit runs (phase-2.md 7.3): a drop sets its preview
 * mark at once, and the dispatcher starts planning only after the next animation frame and one
 * more task, so the pointer-up task holds nothing but the mark (no 100 ms frame at 4x CPU).
 * Without `requestAnimationFrame` (a test, a worker) it is the task alone.
 */
import type { KeyTimers } from '../tjp/cm/android-key';

export function afterPaint(timers: KeyTimers): Promise<void> {
	return new Promise((resolve) => {
		const go = (): void => void timers.setTimeout(resolve, 0);
		if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
		else go();
	});
}

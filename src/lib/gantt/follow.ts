// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where the chart scrolls to when the text selects a task (phase-2.md 6.10, text to visual): the
 * task's row is brought into view, as far as it takes (the same rule as keyboard navigation,
 * `revealTop`), and sideways only when no part of its bar is in view, so that a bar the user can
 * already see never jumps. Nothing here moves the keyboard focus.
 */
import { revealTop } from './layout';

export interface FollowInput {
	/** The row's index among the visible rows. */
	readonly row: number;
	readonly rowHeight: number;
	/** The current scroll offsets and the size of the part of the chart in view. */
	readonly top: number;
	readonly left: number;
	readonly viewW: number;
	readonly viewH: number;
	/** The bar's extent in the chart's own pixels; null when the task is not scheduled. */
	readonly bar: { readonly x0: number; readonly x1: number } | null;
}

/** Share of the view left before the bar when it has to be scrolled to. */
const LEAD = 0.25;

export function followOffsets(a: FollowInput): { top: number; left: number } {
	const top = revealTop(a.row, a.rowHeight, a.top, a.viewH);
	const { bar } = a;
	if (!bar || a.viewW <= 0) return { top, left: a.left };
	const seen = bar.x1 >= a.left && bar.x0 <= a.left + a.viewW;
	return { top, left: seen ? a.left : Math.max(0, Math.round(bar.x0 - a.viewW * LEAD)) };
}

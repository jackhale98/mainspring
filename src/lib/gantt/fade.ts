// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The month label of the time header is `position: sticky` against the task column, so while its
 * month runs out the browser pushes it left, under the column, and a sliver of it ("l 2013") is
 * all that shows. The label fades as the room left in its cell falls below its width, so the
 * sliver is gone before it is a fragment of a word.
 */

/** The room left (as a share of the label's width) at which the label has gone. */
export const FADE_END = 0.5;

/**
 * The label's opacity: 1 while the cell still shows the whole label, falling in a line to 0 at
 * `FADE_END` of its width, 0 below. `remaining` is the cell's width right of the sticky edge,
 * `labelWidth` the label's own, both in px.
 */
export function labelFade(remaining: number, labelWidth: number): number {
	if (!(labelWidth > 0)) return 1;
	const t = (remaining / labelWidth - FADE_END) / (1 - FADE_END);
	return Math.min(1, Math.max(0, t));
}

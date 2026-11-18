// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where a floating panel (a menu, a popover) goes beside the control that opened it, so that it is
 * always inside the viewport (ADR-0016 #3: the Menu and Popover primitives). A pure rule: the
 * components read the rectangles and the viewport, this decides, and the unit test pins the rule at
 * 360 px wide.
 *
 * The panel is `position: fixed` (no view's edge can clip it). Horizontally it lines up with the
 * start or the end of the anchor, then is pulled back inside the viewport's margin. Vertically it
 * opens below the anchor, or above it when there is less room below than above and the panel does not
 * fit below; where neither side has room for its whole height, it takes the larger side and scrolls
 * (`maxHeight`).
 */

/** A rectangle, as a DOMRect gives it. */
export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface PlaceOptions {
	/** Which edge of the anchor the panel lines up with. */
	align: 'start' | 'end';
	/** The space between the anchor and the panel, px. */
	gap?: number;
	/** The least space kept between the panel and the viewport's edges, px. */
	margin?: number;
}

export interface Placed {
	left: number;
	top: number;
	/** The tallest the panel may be where it is, px; it scrolls beyond it. */
	maxHeight: number;
}

export function placeBeside(
	anchor: Box,
	size: { width: number; height: number },
	view: { width: number; height: number },
	{ align, gap = 6, margin = 8 }: PlaceOptions,
): Placed {
	const wanted = align === 'end' ? anchor.right - size.width : anchor.left;
	const widest = Math.max(margin, view.width - size.width - margin);
	const left = Math.min(Math.max(margin, wanted), widest);

	const below = Math.max(0, view.height - anchor.bottom - gap - margin);
	const above = Math.max(0, anchor.top - gap - margin);
	const up = size.height > below && above > below;
	const room = up ? above : below;
	const height = Math.min(size.height, room);
	const top = up ? anchor.top - gap - height : anchor.bottom + gap;
	return { left, top, maxHeight: room };
}

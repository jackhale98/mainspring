// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The part of the chart a person can see and point at while a drag is in flight (phase-2.md 7.2,
 * 9.3). The scroll container reaches under the frozen task column and, while the details are open,
 * under a bottom sheet (tablet, phone) or a drawer over the chart's right edge (a narrow desktop
 * Split). Edge auto-scroll must not wait for a pointer to reach an edge that is covered, so it is
 * measured against what is left. Pure: boxes in, a box and velocities out.
 */
import { autoScrollVelocity } from '../gesture/autoscroll';

export interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface Covers {
	/** The sheet's top edge in viewport px (the distance from the top), or null when none is open. */
	readonly sheetTop: number | null;
	/** The drawer's left edge in viewport px, or null when none is open. */
	readonly drawerLeft: number | null;
}

/**
 * The visible chart: the scroll container without the task column (`chartLeft` from its left) and
 * the time header (`headerHeight` from its top), and without what the sheet and the drawer cover.
 */
export function visibleChart(
	scroller: Box,
	chartLeft: number,
	headerHeight: number,
	covers: Covers,
): Box {
	const right = covers.drawerLeft === null ? scroller.right : Math.min(scroller.right, covers.drawerLeft);
	const bottom = covers.sheetTop === null ? scroller.bottom : Math.min(scroller.bottom, covers.sheetTop);
	const left = scroller.left + chartLeft;
	const top = scroller.top + headerHeight;
	return { left, top, right: Math.max(left, right), bottom: Math.max(top, bottom) };
}

export interface Velocity {
	readonly x: number;
	readonly y: number;
}

/** px/s to scroll by for a pointer (viewport px); `vertical` is off for drags that only move in time. */
export function edgeVelocity(x: number, y: number, box: Box, vertical: boolean): Velocity {
	return {
		x: autoScrollVelocity(x, box.left, box.right),
		y: vertical ? autoScrollVelocity(y, box.top, box.bottom) : 0,
	};
}

/** A sheet of `height` px that ends at the viewport's bottom has its top this far down. */
export const sheetTopOf = (height: number, viewportHeight: number): number | null =>
	height > 0 ? viewportHeight - height : null;

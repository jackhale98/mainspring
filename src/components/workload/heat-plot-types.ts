// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What a view hands HeatPlot when it paints its own picture on the plot's two layers (the Resources
 * lanes, T15): a cells painter and an overlay painter. The overlay painter is given what the
 * gestures draw and the overlay's other inputs, so that it does not have to capture them (a new
 * painter asks for a full repaint). Types only.
 */
import type { Theme } from '../../lib/gantt/paint/theme';
import type { Box, Cell } from '../../lib/workload/heat-layout';
import type { DragMark, HeatLine, PaintStats } from '../../lib/workload/heat-paint';
import type { HeatTheme } from '../../lib/workload/heat-theme';
import type { PressTarget } from './heat-gestures.svelte';

/** Everything the overlay draws that changes without a new model. */
export interface OverlayView {
	/** The hovered and lifted cells and targets, and the drag in flight (from the gestures). */
	readonly hover: Cell | null;
	readonly lifted: Cell | null;
	readonly drag: DragMark | null;
	readonly hoverTarget: PressTarget | null;
	readonly liftedTarget: PressTarget | null;
	readonly lines: readonly HeatLine[];
	readonly selected: Cell | null;
	readonly focus: Cell | null;
	readonly theme: Theme;
	readonly heat: HeatTheme;
}

/** A view's own cells painter (the window is in content coordinates). */
export type DrawCells = (ctx: CanvasRenderingContext2D, win: Box, dpr: number) => PaintStats;

/** A view's own overlay painter. */
export type DrawOverlay = (
	ctx: CanvasRenderingContext2D,
	win: Box,
	dpr: number,
	view: OverlayView,
) => void;

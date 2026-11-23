<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The heatmap's plot (phase-3.md 8.1): two stacked canvases, the cells and an overlay, each holding
	a window of the content (the viewport plus an overscan) that moves with the content, so the
	browser scrolls them natively and they redraw only when the view nears the window's edge, on
	zoom, and when the model, the thresholds, the unit or the colours change. The cells are painted
	by heat-paint.ts; the overlay (today and status-date lines, hover, selection, the focus ring, the
	lifted cell and the drag) is redrawn on its own, so a pointer move or the clock never repaints
	the cells. Both are aria-hidden: the ARIA mirror (HeatGrid.svelte) is the accessible grid. The
	pointer events on the overlay are the gestures' (heat-gestures.svelte.ts).

	The Resources lanes (T15) use this component too: they hand it their own painters
	(`drawCells`, `drawOverlay`) and it keeps everything else, which is most of it: the two layers,
	the window that moves with the content, the dirty flags and the one frame per change, the
	pointer events on the overlay. Without them it paints the heatmap.

	No layout reads in the paint path: sizes come from the props (the parent measures with a
	ResizeObserver through `bind:clientWidth`); a hidden plot has no size to paint into, so a paint
	that finds it hidden keeps what is dirty for when it is shown.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { sizeCanvas } from '../../lib/gantt/paint/canvas';
	import type { Theme } from '../../lib/gantt/paint/theme';
	import type { Box, Cell, HeatLayout } from '../../lib/workload/heat-layout';
	import {
		paintCells,
		overlayLook,
		paintOverlay,
		type HeatLine,
		type PaintStats,
	} from '../../lib/workload/heat-paint';
	import type { HeatUnit } from '../../lib/workload/heat-prefs';
	import type { HeatTheme } from '../../lib/workload/heat-theme';
	import type { LoadModel, Thresholds } from '../../lib/workload/types';
	import type { HeatGestures, PressTarget } from './heat-gestures.svelte';

	import type { DrawCells, DrawOverlay } from './heat-plot-types';

	interface PaintRecord {
		view: string;
		fills: number;
		texts: number;
		ms: number;
	}
	interface Props {
		model: LoadModel;
		layout: HeatLayout;
		win: Box;
		thresholds: Thresholds;
		unit: HeatUnit;
		heat: HeatTheme;
		theme: Theme;
		dpr: number;
		lines: readonly HeatLine[];
		selected: Cell | null;
		focus: Cell | null;
		gestures: HeatGestures;
		/** This view is on screen: a hidden one has no size to paint into (no layout read to find out). */
		shown: boolean;
		/** Called after each cells paint, for the tests and the timings (8.1). */
		onpaint?: ((stats: PaintStats, ms: number) => void) | undefined;
		/** The lanes' painters; a new function asks for a repaint, as a new model does. */
		drawCells?: DrawCells | undefined;
		drawOverlay?: DrawOverlay | undefined;
		/** A value whose change asks for the overlay alone (the lanes' selected task). */
		overlayKey?: unknown;
		/** The prefix of the canvases' test ids (`heat`, or `lane`: both views can be mounted). */
		testid?: string;
	}
	let {
		model,
		layout,
		win,
		thresholds,
		unit,
		heat,
		theme,
		dpr,
		lines,
		selected,
		focus,
		gestures,
		shown,
		onpaint,
		drawCells,
		drawOverlay,
		testid = 'heat',
		overlayKey = undefined,
	}: Props = $props();

	let cellsEl: HTMLCanvasElement | undefined = $state();
	let overlayEl: HTMLCanvasElement | undefined = $state();

	let cellsDirty = false;
	let overlayDirty = false;
	let raf = 0;

	interface Latest {
		model: LoadModel;
		layout: HeatLayout;
		win: Box;
		thresholds: Thresholds;
		unit: HeatUnit;
		heat: HeatTheme;
		theme: Theme;
		dpr: number;
		lines: readonly HeatLine[];
		selected: Cell | null;
		focus: Cell | null;
		shown: boolean;
		drawCells: DrawCells | undefined;
		drawOverlay: DrawOverlay | undefined;
	}
	let latest: Latest | null = null;
	let hover: Cell | null = null;
	let lifted: Cell | null = null;
	let drag: (typeof gestures)['drag'] = null;
	let hoverTarget: PressTarget | null = null;
	let liftedTarget: PressTarget | null = null;

	function frame(el: HTMLCanvasElement, opaque: boolean) {
		const l = latest;
		const ctx = el.getContext('2d', opaque ? { alpha: false } : undefined);
		if (!l || !ctx) return null;
		sizeCanvas(el, l.win.w, l.win.h, l.dpr);
		el.style.transform = `translate(${l.win.x}px, ${l.win.y}px)`;
		return { ctx, l };
	}

	function paint(): void {
		raf = 0;
		// A hidden view has no size to paint into: keep what is dirty for when it is shown (the effect
		// on `shown` asks again). `shown` and the window's size come from the props, so no layout
		// is read in the paint path (phase-3.md 8.1).
		if (!overlayEl || !cellsEl || !latest || !latest.shown || latest.win.w <= 0) return;
		if (cellsDirty) {
			cellsDirty = false;
			const f = frame(cellsEl, true);
			if (f) {
				const { l } = f;
				const t0 = performance.now();
				const stats = l.drawCells
					? l.drawCells(f.ctx, l.win, l.dpr)
					: paintCells({
							ctx: f.ctx,
							win: l.win,
							dpr: l.dpr,
							layout: l.layout,
							model: l.model,
							thresholds: l.thresholds,
							unit: l.unit,
							heat: l.heat,
							surface: l.theme.surface,
							fontSans: l.theme.fontSans,
						});
				const ms = performance.now() - t0;
				onpaint?.(stats, ms);
				// The audit's recorder (tests/e2e/phase3-perf.spec.ts): an array that the page's own
				// init script put there, so that nothing is kept in production.
				(globalThis as { __mainspringPaint?: PaintRecord[] }).__mainspringPaint?.push({
					view: testid,
					fills: stats.fillRects,
					texts: stats.texts,
					ms,
				});
			}
			// The overlay shares the window: it moved and resized with the cells.
			overlayDirty = true;
		}
		if (overlayDirty) {
			overlayDirty = false;
			const o = frame(overlayEl, false);
			const draw = o?.l.drawOverlay;
			if (o && draw) {
				const { l } = o;
				draw(o.ctx, l.win, l.dpr, {
					hover,
					lifted,
					drag,
					hoverTarget,
					liftedTarget,
					lines: l.lines,
					selected: l.selected,
					focus: l.focus,
					theme: l.theme,
					heat: l.heat,
				});
			} else if (o) {
				const { l } = o;
				paintOverlay({
					ctx: o.ctx,
					win: l.win,
					dpr: l.dpr,
					layout: l.layout,
					lines: l.lines,
					selected: l.selected,
					focus: l.focus,
					hover,
					lifted,
					drag,
					...overlayLook(l.theme, l.heat),
				});
			}
		}
	}

	function request(layer: 'cells' | 'overlay'): void {
		if (layer === 'cells') cellsDirty = true;
		else overlayDirty = true;
		if (raf === 0) raf = requestAnimationFrame(paint);
	}

	$effect(() => {
		latest = {
			model,
			layout,
			win,
			thresholds,
			unit,
			heat,
			theme,
			dpr,
			lines,
			selected,
			focus,
			shown,
			drawCells,
			drawOverlay,
		};
		void cellsEl;
		untrack(() => request('cells'));
	});

	// What the gestures draw changes with the pointer: the overlay only.
	$effect(() => {
		hover = gestures.hover;
		lifted = gestures.lifted;
		drag = gestures.drag;
		hoverTarget = gestures.hoverTarget;
		liftedTarget = gestures.liftedTarget;
		untrack(() => request('overlay'));
	});

	// The overlay's own inputs.
	$effect(() => {
		void [lines, selected, focus, overlayKey];
		untrack(() => request('overlay'));
	});

	onDestroy(() => {
		if (raf !== 0) cancelAnimationFrame(raf);
	});

	$effect(() => {
		if (!overlayEl) return;
		return gestures.attach(overlayEl);
	});
</script>

<div class="layers">
	<canvas bind:this={cellsEl} aria-hidden="true" data-testid="{testid}-cells"></canvas>
	<canvas
		bind:this={overlayEl}
		class="overlay"
		style:cursor={gestures.cursor}
		data-testid="{testid}-overlay"
		aria-hidden="true"
	></canvas>
</div>

<style>
	.layers {
		position: absolute;
		inset: 0;
	}
	canvas {
		position: absolute;
		inset-block-start: 0;
		inset-inline-start: 0;
		/* Moved to the painted window by the script; the compositor scrolls them with the content. */
		will-change: transform;
	}
	.overlay {
		cursor: default;
		/* One-finger pans stay native; pinch and drags are the gesture machine's. */
		touch-action: pan-x pan-y;
		/* No text selection and no callout on a long-press (iOS); no tap highlight. */
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		-webkit-tap-highlight-color: transparent;
	}
</style>

<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Gantt's plot (phase-2.md 8.1): three stacked canvases, grid, bars and overlay, each holding
	a window of the content (the viewport plus an overscan) that moves with the content, so the
	browser scrolls them natively and they redraw only when the view nears the window's edge, on
	zoom, and when the model or the colours change. The canvases are aria-hidden: the task list
	beside them is the accessible mirror (treegrid task T18). Pointer events on the top canvas
	select a row; the gesture machine (T9) will take over drags from here.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { strings } from '../../lib/strings';
	import { hitTest } from '../../lib/gantt/hit';
	import type { GanttLayout, PaintWindow } from '../../lib/gantt/layout';
	import type { GanttModel } from '../../lib/gantt/model';
	import type { TickRows } from '../../lib/gantt/ticks';
	import { sizeCanvas, type PaintFrame } from '../../lib/gantt/paint/canvas';
	import { paintBars } from '../../lib/gantt/paint/bars';
	import { paintGrid } from '../../lib/gantt/paint/grid';
	import { NO_OVERLAY, paintOverlay, type OverlayState } from '../../lib/gantt/paint/overlay';
	import type { Theme } from '../../lib/gantt/paint/theme';
	import Mark from '../app/Mark.svelte';

	interface Props {
		model: GanttModel;
		layout: GanttLayout;
		win: PaintWindow;
		ticks: TickRows | null;
		theme: Theme;
		dpr: number;
		selectedRow: number | null;
		/** The wall-clock minute for the today line (`todayOf`); the clock is not in the model. */
		todayMin: number | null;
		/** The width of the viewport, for the placeholder before the first schedule. */
		viewW: number;
		onselect: (row: number) => void;
		onhover: (row: number | null) => void;
	}
	let {
		model,
		layout,
		win,
		ticks,
		theme,
		dpr,
		selectedRow,
		todayMin,
		viewW,
		onselect,
		onhover,
	}: Props = $props();

	let gridEl: HTMLCanvasElement | undefined = $state();
	let barsEl: HTMLCanvasElement | undefined = $state();
	let overlayEl: HTMLCanvasElement | undefined = $state();

	let hoverRow = $state<number | null>(null);
	let hoverLink = $state<number | null>(null);

	/** What the next animation frame paints; written by the effects, read by `frameFor`. */
	interface Latest {
		model: GanttModel;
		layout: GanttLayout;
		win: PaintWindow;
		ticks: TickRows | null;
		theme: Theme;
		dpr: number;
	}
	let latest: Latest | null = null;
	let overlayState: OverlayState = NO_OVERLAY;
	/** The row tinted on the grid layer, under the bars. */
	let gridSelected: number | null = null;
	let baseDirty = false;
	let gridDirty = false;
	let overlayDirty = false;
	let raf = 0;

	function frameFor(el: HTMLCanvasElement, opaque: boolean): PaintFrame | null {
		const l = latest;
		const ctx = el.getContext('2d', opaque ? { alpha: false } : undefined);
		if (!l || !ctx) return null;
		sizeCanvas(el, l.win.w, l.win.h, l.dpr);
		el.style.transform = `translate(${l.win.x}px, ${l.win.y}px)`;
		return { ctx, win: l.win, dpr: l.dpr, layout: l.layout, model: l.model, theme: l.theme };
	}

	function paint(): void {
		raf = 0;
		// A hidden panel has no size to paint into: keep what is dirty for when it is shown (the
		// resize that comes with showing it makes the effects ask again).
		if (!overlayEl || overlayEl.getClientRects().length === 0) return;
		if ((baseDirty || gridDirty) && gridEl && barsEl) {
			const g = frameFor(gridEl, true);
			if (g) paintGrid(g, latest?.ticks ?? null, gridSelected);
			if (baseDirty) {
				const b = frameFor(barsEl, false);
				if (b) paintBars(b);
			}
			baseDirty = false;
			gridDirty = false;
			// The overlay shares the window: it moved and resized with the others.
			overlayDirty = true;
		}
		if (overlayDirty && overlayEl) {
			overlayDirty = false;
			const o = frameFor(overlayEl, false);
			if (o) paintOverlay(o, overlayState);
		}
	}

	function request(layer: 'base' | 'grid' | 'overlay'): void {
		if (layer === 'base') baseDirty = true;
		else if (layer === 'grid') gridDirty = true;
		else overlayDirty = true;
		if (raf === 0) raf = requestAnimationFrame(paint);
	}

	$effect(() => {
		latest = { model, layout, win, ticks, theme, dpr };
		void gridEl;
		void barsEl;
		untrack(() => request('base'));
	});

	$effect(() => {
		overlayState = { selectedRow, hoverRow, hoverLink, todayMin };
		untrack(() => request('overlay'));
	});

	// A selection tints a row on the grid layer, which sits under the bars: redraw that one only.
	$effect(() => {
		gridSelected = selectedRow;
		untrack(() => request('grid'));
	});

	onDestroy(() => {
		if (raf !== 0) cancelAnimationFrame(raf);
	});

	// A pointer press that barely moves is a tap; anything more is a scroll or, later, a drag.
	let down: { id: number; x: number; y: number; at: { x: number; y: number } } | null = null;
	const slopOf = (e: PointerEvent): number => (e.pointerType === 'touch' ? 8 : 4);

	function contentPoint(e: PointerEvent): { x: number; y: number } {
		const r = overlayEl?.getBoundingClientRect();
		return { x: e.clientX - (r?.left ?? 0) + win.x, y: e.clientY - (r?.top ?? 0) + win.y };
	}

	function onpointermove(e: PointerEvent): void {
		if (e.pointerType === 'touch') return;
		const p = contentPoint(e);
		const hit = hitTest(layout, model, p.x, p.y);
		const row = hit.kind === 'link' ? null : hit.row;
		const link = hit.kind === 'link' ? hit.link : null;
		if (row !== hoverRow) {
			hoverRow = row;
			onhover(row);
		}
		if (link !== hoverLink) hoverLink = link;
	}

	function onpointerleave(): void {
		if (hoverRow !== null) onhover(null);
		hoverRow = null;
		hoverLink = null;
	}

	function onpointerdown(e: PointerEvent): void {
		if (e.button !== 0) return;
		// The point is taken now: the layout around the chart may shift before the pointer is up.
		down = { id: e.pointerId, x: e.clientX, y: e.clientY, at: contentPoint(e) };
	}

	function onpointerup(e: PointerEvent): void {
		const start = down;
		down = null;
		if (!start || start.id !== e.pointerId) return;
		if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > slopOf(e)) return;
		const hit = hitTest(layout, model, start.at.x, start.at.y);
		// A tap that misses a link by a little lands on the row it is in.
		const row = hit.kind === 'link' ? layout.rowAt(start.at.y) : hit.row;
		if (row !== null) onselect(row);
	}
</script>

<div class="plot" style:width="{layout.width}px" style:height="{layout.height}px">
	{#if !model.scheduled}
		<p class="placeholder" role="status" style:width="{viewW}px">
			<Mark size={44} busy />{strings.gantt.scheduling}
		</p>
	{/if}
	<div class="layers">
		<canvas bind:this={gridEl} aria-hidden="true"></canvas>
		<canvas bind:this={barsEl} aria-hidden="true"></canvas>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<canvas
			bind:this={overlayEl}
			class="overlay"
			class:pointer={hoverRow !== null}
			data-testid="gantt-overlay"
			aria-hidden="true"
			{onpointerdown}
			{onpointermove}
			{onpointerup}
			{onpointerleave}
			onpointercancel={() => (down = null)}
		></canvas>
	</div>
</div>

<style>
	.placeholder {
		position: sticky;
		inset-inline-start: var(--gantt-names);
		z-index: 1;
		box-sizing: border-box;
		block-size: 0;
		margin: 0;
		padding-block-start: var(--space-6);
		overflow: visible;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		color: var(--color-gantt-text-muted);
		pointer-events: none;
	}
	/* `clip`, not `hidden`: the placeholder inside is sticky against the scroller, and a hidden
	   overflow would make this box its scroll container (it then sat a name column too far right). */
	.plot {
		position: relative;
		overflow: clip;
	}
	/* A continuous zoom stretches the layers about the point under the pointer (Gantt.svelte). */
	.layers {
		position: absolute;
		inset: 0;
		transform: scaleX(var(--zoom-ratio, 1));
		transform-origin: var(--zoom-origin, 0px) 0;
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
		/* One-finger pans stay native; pinch and drags are the gesture machine's (T9). */
		touch-action: pan-x pan-y;
	}
	.overlay.pointer {
		cursor: pointer;
	}
</style>

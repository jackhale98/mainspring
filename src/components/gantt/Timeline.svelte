<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Gantt's plot (phase-2.md 8.1): three stacked canvases, grid, bars and overlay, each holding
	a window of the content (the viewport plus an overscan) that moves with the content, so the
	browser scrolls them natively and they redraw only when the view nears the window's edge, on
	zoom, and when the model or the colours change. The canvases are aria-hidden: the task list
	beside them is the accessible mirror (treegrid task T18). The pointer events on the top canvas
	are the gestures' (gestures.svelte.ts feeds them to the shared controller): this component only
	draws what they say, on the overlay: the handles of the selected bar, the preview of a dragged
	bar, the pending bars that stay until the engine answers, a link being made and its target.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { strings } from '../../lib/strings';
	import type { HandleSet } from '../../lib/gantt/handles';
	import type { GanttLayout, PaintWindow } from '../../lib/gantt/layout';
	import type { GanttModel } from '../../lib/gantt/model';
	import type { TickRows } from '../../lib/gantt/ticks';
	import { sizeCanvas, type PaintFrame } from '../../lib/gantt/paint/canvas';
	import { paintBars } from '../../lib/gantt/paint/bars';
	import { paintGrid } from '../../lib/gantt/paint/grid';
	import {
		NO_GESTURE,
		type GestureLabel,
		type GestureOverlay,
		type LinkTarget,
	} from '../../lib/gantt/paint/gestures';
	import { NO_OVERLAY, paintOverlay, type OverlayState } from '../../lib/gantt/paint/overlay';
	import type { Ghost } from '../../lib/gantt/preview';
	import type { Theme } from '../../lib/gantt/paint/theme';
	import Mark from '../app/Mark.svelte';
	import type { GanttGestures } from './gestures.svelte';
	import type { LinkState } from './link-mode.svelte';

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
		/** The plot's width: the content, at least as wide as the viewport. */
		contentW: number;
		/** The pointer wiring: its preview and cursor are drawn here, its events come from here. */
		gestures: GanttGestures;
		/** The handles of the selected bar, or null. */
		handles: HandleSet | null;
		/** Bars the dispatcher holds as preview or pending (a dropped drag, a key nudge). */
		pending: readonly Ghost[];
		/** The link being made, or null. */
		link: LinkState | null;
		/** The link selected for removal, as an index into the model's links. */
		selectedLink: number | null;
		/** The row with the keyboard focus in the task list, to ring (10.2). */
		focusRow: number | null;
		/** The content x range in view, so that a label never hangs where it is cut off. */
		within: { readonly left: number; readonly right: number };
		/** A person dragged from the palette: the bar it is over and the label. */
		palette: { readonly row: number | null; readonly label: GestureLabel | null } | null;
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
		contentW,
		gestures,
		handles,
		pending,
		link,
		selectedLink,
		focusRow,
		within,
		palette,
	}: Props = $props();

	let gridEl: HTMLCanvasElement | undefined = $state();
	let barsEl: HTMLCanvasElement | undefined = $state();
	let overlayEl: HTMLCanvasElement | undefined = $state();

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

	/** The label a link in progress hangs: by the pointer, else by the target bar (a key, a tap). */
	function linkLabel(l: LinkState): GestureLabel | null {
		if (l.target === null || l.message === null) return null;
		const bar = layout.barRect(l.target);
		const x = l.x ?? (bar ? bar.x + bar.w : 0);
		const y = l.y ?? (bar ? bar.y : 0);
		return { text: l.message, x, y, blocked: l.ok === false, within };
	}

	/** Everything the gestures draw, from the drag in flight, the pending bars and the link mode. */
	const gesture = $derived.by<GestureOverlay>(() => {
		const d = gestures.drag;
		const ghosts = d?.ghost ? [...pending.filter((g) => g.row !== d.ghost?.row), d.ghost] : pending;
		const target: LinkTarget | null =
			link?.target != null
				? { row: link.target, ok: link.ok !== false }
				: palette?.row != null
					? { row: palette.row, ok: true }
					: null;
		const paletteLabel = palette?.label ? { ...palette.label, within } : null;
		const label = d?.label ?? (link ? linkLabel(link) : null) ?? paletteLabel;
		if (!d && !link && !palette && pending.length === 0 && !handles && selectedLink === null) {
			return NO_GESTURE;
		}
		return {
			handles,
			ghosts,
			band: link ? { fromRow: link.from, x: link.x, y: link.y } : null,
			target,
			label,
			lifted: d?.lifted ?? null,
			selectedLink,
		};
	});

	$effect(() => {
		overlayState = {
			selectedRow,
			hoverRow: gestures.hoverRow,
			hoverLink: gestures.hoverLink,
			todayMin,
			focusRow,
			gesture,
		};
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

	// The pointer events on the overlay are the gestures': it listens, this draws.
	$effect(() => {
		if (!overlayEl) return;
		return gestures.attach(overlayEl);
	});
</script>

<div class="plot" style:width="{contentW}px" style:height="{layout.height}px">
	{#if !model.scheduled}
		<p class="placeholder" role="status" style:width="{viewW}px">
			<Mark size={44} busy />{strings.gantt.scheduling}
		</p>
	{/if}
	<div class="layers">
		<canvas bind:this={gridEl} aria-hidden="true"></canvas>
		<canvas bind:this={barsEl} aria-hidden="true"></canvas>
		<canvas
			bind:this={overlayEl}
			class="overlay"
			style:cursor={gestures.cursor}
			data-testid="gantt-overlay"
			aria-hidden="true"
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
		/* One-finger pans stay native; pinch and drags are the gesture controller's (8.2). */
		touch-action: pan-x pan-y;
		/* No text selection and no callout on a long-press (iOS); no tap highlight. */
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		-webkit-tap-highlight-color: transparent;
	}
</style>

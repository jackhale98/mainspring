<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The time header (phase-2.md 6.4): one canvas over the same x window as the plot, so its cell
	edges scroll with the bars. It sits in the scroll container with `position: sticky` and is
	redrawn when the window, zoom or colours change, and on every scroll step while it has sticky
	labels (a cheap draw: two rows of text). aria-hidden; the dates a screen reader needs are in
	the task list.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { GanttLayout, PaintWindow } from '../../lib/gantt/layout';
	import type { GanttModel } from '../../lib/gantt/model';
	import { sizeCanvas } from '../../lib/gantt/paint/canvas';
	import { markerLines } from '../../lib/gantt/paint/grid';
	import { paintHeader } from '../../lib/gantt/paint/header';
	import type { Theme } from '../../lib/gantt/paint/theme';
	import type { TickRows } from '../../lib/gantt/ticks';

	interface Props {
		model: GanttModel;
		layout: GanttLayout;
		win: PaintWindow;
		ticks: TickRows | null;
		theme: Theme;
		dpr: number;
		scrollLeft: number;
	}
	let { model, layout, win, ticks, theme, dpr, scrollLeft }: Props = $props();

	let el: HTMLCanvasElement | undefined = $state();
	let raf = 0;

	function draw(): void {
		raf = 0;
		const c = el;
		// Hidden: nothing to paint into. The resize on showing it asks again.
		if (!c || c.getClientRects().length === 0) return;
		const ctx = c?.getContext('2d', { alpha: false });
		if (!c || !ctx) return;
		sizeCanvas(c, win.w, layout.metrics.headerHeight, dpr);
		c.style.transform = `translateX(${win.x}px)`;
		const base = { ctx, win: { x: win.x, w: win.w }, dpr, scale: layout.scale, theme };
		if (!ticks) {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.fillStyle = theme.surfaceHeader;
			ctx.fillRect(0, 0, c.width, c.height);
			return;
		}
		paintHeader({ ...base, ticks, markers: markerLines(model), viewLeft: scrollLeft });
	}

	$effect(() => {
		void [model, layout, win, ticks, theme, dpr, scrollLeft, el];
		untrack(() => {
			if (raf === 0) raf = requestAnimationFrame(draw);
		});
	});

	onDestroy(() => {
		if (raf !== 0) cancelAnimationFrame(raf);
	});
</script>

<div class="layer">
	<canvas bind:this={el} aria-hidden="true" data-testid="gantt-header"></canvas>
</div>

<style>
	/* A continuous zoom stretches the header with the plot (Gantt.svelte). */
	.layer {
		transform: scaleX(var(--zoom-ratio, 1));
		transform-origin: var(--zoom-origin, 0px) 0;
	}
	canvas {
		display: block;
		will-change: transform;
	}
</style>

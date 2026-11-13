<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The time header (phase-2.md 6.4, 9.2): frozen at the top and moving with the chart sideways
	only. It sits in the scroll container with `position: sticky`, so the compositor moves it with
	the content and nothing about it is repainted on a scroll event. Two layers share one x window
	with the plot:
	- a canvas with the lower row (days or weeks), the bottom edge and the today crown, painted
	  once for the overscanned window and again only when that window, the zoom or the colours
	  change (never per scroll step);
	- the upper row of months as DOM text in the display serif, each in a cell as wide as its
	  month, with a label that is \`position: sticky\` against the task column. The browser keeps a
	  month's name in view while the month scrolls by, and it moves exactly with the bars: no
	  frame behind, no jitter.
	The canvas is told to draw no major labels (the paint code would pin them to the view, which
	needs a repaint per scroll). aria-hidden; the dates a screen reader needs are in the task list.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { GanttLayout, PaintWindow } from '../../lib/gantt/layout';
	import type { GanttModel } from '../../lib/gantt/model';
	import { sizeCanvas, textWidth } from '../../lib/gantt/paint/canvas';
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
	}
	let { model, layout, win, ticks, theme, dpr }: Props = $props();

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
		// No major labels on the canvas (module comment); `viewLeft` is then not read for them.
		paintHeader({
			...base,
			ticks: { level: ticks.level, major: [], minor: ticks.minor },
			markers: markerLines(model),
			viewLeft: win.x,
		});
	}

	// Repaint when the window, zoom, model or colours change: not on scroll.
	$effect(() => {
		void [model, layout, win, ticks, theme, dpr, el];
		untrack(() => {
			if (raf === 0) raf = requestAnimationFrame(draw);
		});
	});

	onDestroy(() => {
		if (raf !== 0) cancelAnimationFrame(raf);
	});

	/** A label of the form "March 2026": the month, then the year it should be set apart from. */
	const MONTH_YEAR = /^(.*\S)\s+(\d{4})$/;
	interface Cell {
		readonly key: number;
		readonly x: number;
		readonly w: number;
		readonly name: string;
		readonly year: string;
	}

	let measure: CanvasRenderingContext2D | null = null;
	function widthOf(name: string, year: string): number {
		measure ??= document.createElement('canvas').getContext('2d');
		if (!measure) return name.length * 10 + year.length * 8;
		const display = `${theme.headerFontSize}px ${theme.fontDisplay}`;
		measure.font = display;
		const n = textWidth(measure, name);
		if (year === '') return n;
		measure.font = `italic ${display}`;
		return n + textWidth(measure, ' ' + year) + 1;
	}

	/** The month cells in the painted window whose label fits: a clipped name would read as noise. */
	const cells = $derived.by<readonly Cell[]>(() => {
		if (!ticks) return [];
		const out: Cell[] = [];
		for (const t of ticks.major) {
			const x0 = layout.scale.x(t.at);
			const x1 = layout.scale.x(t.end);
			if (x1 < win.x - 1 || x0 > win.x + win.w + 1) continue;
			const parts = MONTH_YEAR.exec(t.label);
			const name = parts?.[1] ?? t.label;
			const year = parts?.[2] ?? '';
			if (x1 - x0 < widthOf(name, year) + 2 * theme.labelPad) continue;
			out.push({ key: t.at, x: x0, w: x1 - x0, name, year });
		}
		return out;
	});
</script>

<div class="layer">
	<canvas bind:this={el} aria-hidden="true" data-testid="gantt-header"></canvas>
	<div class="months" aria-hidden="true">
		{#each cells as c (c.key)}
			<div class="cell" style:left="{c.x}px" style:width="{c.w}px">
				<span class="label"
					>{c.name}{#if c.year !== ''}<span class="year"> {c.year}</span>{/if}</span
				>
			</div>
		{/each}
	</div>
</div>

<style>
	/* A continuous zoom stretches the header with the plot (Gantt.svelte). */
	.layer {
		position: relative;
		transform: scaleX(var(--zoom-ratio, 1));
		transform-origin: var(--zoom-origin, 0px) 0;
	}
	canvas {
		display: block;
		will-change: transform;
	}
	.months {
		position: absolute;
		inset-block-start: 0;
		inset-inline: 0;
		block-size: var(--gantt-header-row-height);
		pointer-events: none;
	}
	.cell {
		position: absolute;
		inset-block: 0;
	}
	/* Sticky against the task column: the compositor keeps the name in view, inside its month. */
	.label {
		position: sticky;
		inset-inline-start: var(--gantt-names);
		display: inline-block;
		padding-inline-start: var(--gantt-label-pad);
		color: var(--color-gantt-text);
		font-family: var(--font-display);
		font-size: var(--gantt-header-font-size);
		line-height: calc(var(--gantt-header-row-height) + 2px);
		white-space: nowrap;
	}
	.year {
		margin-inline-start: 0.25em;
		color: var(--color-gantt-text-faint);
		font-style: italic;
	}
</style>

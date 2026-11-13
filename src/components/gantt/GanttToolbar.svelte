<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Gantt's toolbar: zoom out, zoom in, the zoom level, Today, a line about the selected (or
	hovered) task, and a legend for the today and status-date lines. Only DOM and tokens: it holds no
	state, the Gantt owns the zoom. The selected task's line is a polite live region; the hovered
	one is shown but not announced.
-->
<script lang="ts">
	import { canZoomIn, canZoomOut, nearestLevel } from '../../lib/gantt/scale';
	import { strings } from '../../lib/strings';

	interface Props {
		pxPerDay: number;
		selectedText: string;
		hoverText: string;
		/** Whether Today has a line to go to. */
		hasMarker: boolean;
		lines: { today: boolean; status: boolean; merged: boolean };
		dimmed: boolean;
		onzoomin: () => void;
		onzoomout: () => void;
		ontoday: () => void;
	}
	let {
		pxPerDay,
		selectedText,
		hoverText,
		hasMarker,
		lines,
		dimmed,
		onzoomin,
		onzoomout,
		ontoday,
	}: Props = $props();
</script>

<div class="toolbar" role="toolbar" aria-label={strings.gantt.toolbar}>
	<div class="group">
		<button type="button" onclick={onzoomout} disabled={!canZoomOut(pxPerDay)}>
			{strings.gantt.zoomOut}
		</button>
		<button type="button" onclick={onzoomin} disabled={!canZoomIn(pxPerDay)}>
			{strings.gantt.zoomIn}
		</button>
		<span class="level">{strings.gantt.zoomLevel(nearestLevel(pxPerDay))}</span>
		<button type="button" onclick={ontoday} disabled={!hasMarker}>{strings.gantt.today}</button>
	</div>
	<p class="summary" role="status" class:sr-only={hoverText !== ''}>{selectedText}</p>
	{#if hoverText !== ''}<p class="summary" aria-hidden="true">{hoverText}</p>{/if}
	<ul class="legend" aria-label={strings.gantt.legend}>
		{#if lines.merged}
			<li><i class="line today"></i>{strings.gantt.lines.both}</li>
		{:else}
			{#if lines.today}<li><i class="line today"></i>{strings.gantt.lines.today}</li>{/if}
			{#if lines.status}<li><i class="line status"></i>{strings.gantt.lines.status}</li>{/if}
		{/if}
		{#if dimmed}<li class="stale">{strings.gantt.lastGood}</li>{/if}
	</ul>
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		padding: var(--space-1) var(--space-2);
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface-header);
	}
	.group {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.group button {
		min-block-size: 2rem;
		padding-inline: var(--space-3);
		border: 1px solid var(--color-gantt-border);
		border-radius: var(--radius-sm);
		background: var(--color-gantt-surface);
		color: var(--color-gantt-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.group button:hover:not(:disabled) {
		background: var(--color-gantt-row-hover);
	}
	.group button:disabled {
		color: var(--color-gantt-text-muted);
		cursor: default;
	}
	.level {
		min-inline-size: 5.5rem;
		text-align: center;
		color: var(--color-gantt-text-muted);
		font-size: var(--text-sm);
	}
	.summary {
		flex: 1 1 12rem;
		/* The line is always there, empty or not, so showing a task never shifts the chart. */
		min-block-size: 1.5rem;
		line-height: 1.5rem;
		font-variant-numeric: tabular-nums;
		min-inline-size: 0;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-gantt-text);
		font-size: var(--text-sm);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--color-gantt-text-muted);
		font-size: var(--text-xs);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.line {
		display: inline-block;
		inline-size: var(--gantt-marker-width);
		block-size: 0.9rem;
	}
	.line.today {
		background: var(--color-today);
	}
	.line.status {
		background: repeating-linear-gradient(
			to bottom,
			var(--color-status-date) 0 calc(var(--gantt-dash) * 1.5),
			transparent calc(var(--gantt-dash) * 1.5) calc(var(--gantt-dash) * 2.5)
		);
	}
	.stale {
		color: var(--color-pending);
		font-weight: 600;
	}
	@media (max-width: 599px) {
		.legend {
			display: none;
		}
	}
	@media (pointer: coarse) {
		.group button {
			min-block-size: var(--size-tap);
			min-inline-size: var(--size-tap);
		}
	}
</style>

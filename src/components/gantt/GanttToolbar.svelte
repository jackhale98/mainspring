<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Gantt's toolbar: zoom out, zoom in, the zoom level, Today, a line about the selected (or
	hovered) task, and a legend for the today and status-date lines. Only DOM and tokens: it holds no
	state, the Gantt owns the zoom. The selected task's line is a polite live region; the hovered
	one is shown but not announced. On a phone the buttons are icons (the words stay for screen
	readers) and everything sits in one row; the task line fills what is left of it, and is empty
	until a task is selected, so showing it never moves the chart.
-->
<script lang="ts">
	import { canZoomIn, canZoomOut, nearestLevel } from '../../lib/gantt/scale';
	import type { LineState } from '../../lib/gantt/model';
	import { strings } from '../../lib/strings';

	interface Props {
		pxPerDay: number;
		selectedText: string;
		hoverText: string;
		/** Whether Today has a line on the chart to go to. */
		hasMarker: boolean;
		lines: { today: LineState; status: LineState; merged: boolean };
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

	const L = strings.gantt.lines;
	const label = (text: string, state: LineState): string => (state === 'off' ? L.off(text) : text);
</script>

<div class="toolbar" role="toolbar" aria-label={strings.gantt.toolbar}>
	<div class="group">
		<button type="button" onclick={onzoomout} disabled={!canZoomOut(pxPerDay)}>
			<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
			<span class="label">{strings.gantt.zoomOut}</span>
		</button>
		<button type="button" onclick={onzoomin} disabled={!canZoomIn(pxPerDay)}>
			<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" /></svg>
			<span class="label">{strings.gantt.zoomIn}</span>
		</button>
		<span class="level">{strings.gantt.zoomLevel(nearestLevel(pxPerDay))}</span>
		<button type="button" onclick={ontoday} disabled={!hasMarker}>
			<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
				<circle cx="8" cy="8" r="4" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
			</svg>
			<span class="label">{strings.gantt.today}</span>
		</button>
	</div>
	<p class="summary" role="status" class:sr-only={hoverText !== ''}>{selectedText}</p>
	{#if hoverText !== ''}<p class="summary" aria-hidden="true">{hoverText}</p>{/if}
	<ul class="legend" aria-label={strings.gantt.legend}>
		{#if lines.merged}
			<li class:off={lines.today === 'off'}>
				<i class="line today"></i>{label(L.both, lines.today)}
			</li>
		{:else}
			{#if lines.today}
				<li class:off={lines.today === 'off'}>
					<i class="line today"></i>{label(L.today, lines.today)}
				</li>
			{/if}
			{#if lines.status}
				<li class:off={lines.status === 'off'}>
					<i class="line status"></i>{label(L.status, lines.status)}
				</li>
			{/if}
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
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-block-size: 2rem;
		padding-inline: var(--space-3);
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-gantt-surface);
		color: var(--color-gantt-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: var(--color-gantt-row-hover);
	}
	button:disabled {
		color: var(--color-gantt-text-muted);
		opacity: 0.6;
		cursor: default;
	}
	.icon {
		display: none;
		inline-size: 1rem;
		block-size: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
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
	.legend li.off {
		font-style: italic;
	}
	.legend li.off .line {
		opacity: 0.4;
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
		.toolbar {
			flex-wrap: nowrap;
			gap: var(--space-2);
		}
		.group {
			flex: none;
			gap: var(--space-1);
		}
		button {
			padding-inline: 0;
			min-inline-size: var(--size-tap);
			min-block-size: var(--size-tap);
		}
		.icon {
			display: block;
		}
		.label {
			position: absolute;
			inline-size: 1px;
			block-size: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.level,
		.legend {
			display: none;
		}
		.summary {
			flex: 1 1 0;
			font-size: var(--text-xs);
		}
	}
</style>

<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Gantt's floating chips (ADR-0009): the zoom (a dropdown), Today and the critical-path
	toggle as pills with a glass background over the top left of the chart, and, at its foot, a
	pill with the selected (or hovered) task and one with the legend of the today and status-date
	lines. On a phone the chips are one compact row above the chart instead. Only DOM and tokens:
	it holds no state; the Gantt owns the zoom. The selected task's line is a polite live region
	with the people on it; the hovered one is shown but not announced. The task line is a pill that
	floats over the chart and exists only while there is a task, so it never moves the chart.
-->
<script lang="ts">
	import { ZOOM_ORDER, nearestLevel, type ZoomLevel } from '../../lib/gantt/scale';
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
		/** The critical-path toggle: available once the analysis exists; `note` is its tooltip. */
		critical: { available: boolean; pressed: boolean; note: string };
		onlevel: (level: ZoomLevel) => void;
		ontoday: () => void;
		oncritical: () => void;
	}
	let {
		pxPerDay,
		selectedText,
		hoverText,
		hasMarker,
		lines,
		dimmed,
		critical,
		onlevel,
		ontoday,
		oncritical,
	}: Props = $props();

	const L = strings.gantt.lines;
	const label = (text: string, state: LineState): string => (state === 'off' ? L.off(text) : text);
	const level = $derived(nearestLevel(pxPerDay));
</script>

<div class="chips" role="toolbar" aria-label={strings.gantt.toolbar}>
	<label class="chip select">
		<span class="sr-only">{strings.gantt.zoom}</span>
		<select
			value={level}
			onchange={(e) => onlevel(e.currentTarget.value as ZoomLevel)}
			aria-label={strings.gantt.zoom}
		>
			{#each ZOOM_ORDER as z (z)}
				<option value={z}>{strings.gantt.level[z]}</option>
			{/each}
		</select>
		<svg class="caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
	</label>
	<button
		type="button"
		class="chip"
		onclick={ontoday}
		disabled={!hasMarker}
		aria-label={hasMarker ? strings.gantt.today : strings.gantt.todayOff}
	>
		{strings.gantt.today}
	</button>
	<button
		type="button"
		class="chip critical"
		aria-pressed={critical.available && critical.pressed}
		disabled={!critical.available}
		title={critical.note}
		onclick={oncritical}
	>
		<i class="steel" aria-hidden="true"></i>{strings.gantt.criticalPath}
	</button>
</div>

<!-- The task line is a live region that always exists; its pill shows only with text. -->
<p class="task" role="status" class:sr-only={selectedText === '' || hoverText !== ''}>
	{selectedText}
</p>
{#if hoverText !== ''}<p class="task hover" aria-hidden="true">{hoverText}</p>{/if}
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

<style>
	.chips {
		position: absolute;
		z-index: 6;
		inset-block-start: calc(var(--gantt-header-row-height) * 2 + 12px);
		inset-inline-start: calc(var(--gantt-names) + 14px);
		display: flex;
		gap: var(--space-2);
	}
	.chip {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		block-size: var(--gantt-chip-height);
		padding-inline: 12px;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		box-shadow: var(--gantt-chip-shadow);
		color: var(--color-gantt-text);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 500;
		backdrop-filter: blur(6px);
		cursor: pointer;
	}
	.chip:hover:not(:disabled) {
		background: var(--color-gantt-inset);
	}
	.chip:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.chip:focus-visible,
	.chip:has(select:focus-visible) {
		outline: 2px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	.select {
		padding-inline-end: 26px;
	}
	select {
		appearance: none;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		outline: none;
		padding: 0;
	}
	.caret {
		position: absolute;
		inset-inline-end: 10px;
		inline-size: 10px;
		block-size: 10px;
		fill: none;
		stroke: var(--color-gantt-text-muted);
		stroke-width: 1.5;
		stroke-linecap: round;
		pointer-events: none;
	}
	.critical[aria-pressed='true'] {
		border-color: var(--color-gantt-crit-border);
		background: var(--color-gantt-accent-wash);
		color: var(--color-gantt-accent-ink);
		font-weight: 600;
	}
	.steel {
		inline-size: 8px;
		block-size: 8px;
		border-radius: 50%;
		background: linear-gradient(
			180deg,
			var(--color-gantt-steel-top),
			var(--color-gantt-steel-bottom)
		);
	}
	.task {
		position: absolute;
		z-index: 6;
		inset-block-end: 14px;
		inset-inline-start: calc(var(--gantt-names) + 14px);
		max-inline-size: calc(100% - var(--gantt-names) - 28px);
		box-sizing: border-box;
		margin: 0;
		padding: 6px 14px;
		overflow: hidden;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		box-shadow: var(--gantt-chip-shadow);
		color: var(--color-gantt-text);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		text-overflow: ellipsis;
		white-space: nowrap;
		backdrop-filter: blur(6px);
		pointer-events: none;
	}
	.task.hover {
		z-index: 7;
	}
	.legend {
		position: absolute;
		z-index: 6;
		inset-block-start: calc(var(--gantt-header-row-height) * 2 + 12px);
		inset-inline-end: 22px;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		padding: 6px 12px;
		list-style: none;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		box-shadow: var(--gantt-chip-shadow);
		color: var(--color-gantt-text-muted);
		font-size: var(--text-xs);
		backdrop-filter: blur(6px);
		pointer-events: none;
	}
	.legend:not(:has(li)) {
		display: none;
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
	@media (pointer: coarse) {
		.chip {
			min-block-size: var(--size-tap);
		}
	}
	/* A phone: the chips are one compact row above the chart; nothing floats over it but the
	   task line, which has no room to spare and shows only with a task. */
	@media (max-width: 599px) {
		.chips {
			position: static;
			padding: var(--space-2) var(--space-2);
			background: var(--color-gantt-surface);
			border-block-end: 1px solid var(--color-gantt-border);
			flex-wrap: nowrap;
		}
		.legend {
			display: none;
		}
		.task {
			inset-inline-start: var(--space-2);
			max-inline-size: calc(100% - 2 * var(--space-2));
		}
		.task:not(.sr-only) {
			inset-block-end: var(--space-2);
		}
	}
</style>

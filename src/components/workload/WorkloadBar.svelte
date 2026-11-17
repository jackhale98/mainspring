<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Workload toolbar (phase-3.md 9.2, 9.3): the zoom (Day, Week, Month), the unit (Hours or %),
	the thresholds, Today, and the legend of the bands. On a desktop and a tablet these chips sit
	in the People view's bar after the view switcher; on a phone they are one compact row above the
	heatmap (the zoom is a menu, the thresholds an icon that opens a sheet, Today an icon). Between
	them and the legend is the cell line: the hovered cell (not announced) or the selected one (a
	polite live region), in the words of its accessible name; on a phone it floats at the foot of
	the heatmap, as the Gantt's task line does.

	The legend says what each band looks like, with its cue besides colour (over is hatched and has
	a corner mark), and shows the today and status-date lines when they are on the chart, as the
	Gantt's does. It holds no state: the heatmap owns the choices.
-->
<script lang="ts">
	import type { HeatUnit } from '../../lib/workload/heat-prefs';
	import { workloadStrings as W } from '../../lib/strings';
	import type { BucketKind, Thresholds } from '../../lib/workload/types';
	import Icon from '../Icon.svelte';
	import SegmentTabs from '../people/SegmentTabs.svelte';
	import BandLegend from './BandLegend.svelte';
	import ThresholdsPopover from './ThresholdsPopover.svelte';

	type Line = 'on' | 'off' | null;
	interface Props {
		zoom: BucketKind;
		unit: HeatUnit;
		thresholds: Thresholds;
		onzoom: (z: BucketKind) => void;
		onunit: (u: HeatUnit) => void;
		onthresholds: (t: Thresholds) => boolean;
		ontoday: () => void;
		/** Whether Today has a column to go to. */
		hasToday: boolean;
		dimmed: boolean;
		/** The hovered cell's sentence (shown, not announced). */
		hover: string;
		/** The selected cell's sentence (announced). */
		selected: string;
		lines: { today: Line; status: Line; merged: boolean };
		/** Which copy this is: ids differ between the toolbar's two places. */
		scope: string;
	}
	let {
		zoom,
		unit,
		thresholds,
		onzoom,
		onunit,
		onthresholds,
		ontoday,
		hasToday,
		dimmed,
		hover,
		selected,
		lines,
		scope,
	}: Props = $props();

	const ZOOMS = [
		{ id: 'day' as const, label: W.level.day },
		{ id: 'week' as const, label: W.level.week },
		{ id: 'month' as const, label: W.level.month },
	];
	const UNITS = [
		{ id: 'hours' as const, label: W.unitHours },
		{ id: 'percent' as const, label: W.unitPercent },
	];
</script>

<div class="chips" role="group" aria-label={W.toolbar} data-testid="heat-toolbar">
	<span class="zoom-radios">
		<SegmentTabs
			items={ZOOMS}
			value={zoom}
			onchange={onzoom}
			label={W.zoom}
			prefix="heat-zoom-{scope}"
			kind="radios"
		/>
	</span>
	<label class="chip select zoom-select">
		<span class="sr-only">{W.zoom}</span>
		<select
			value={zoom}
			aria-label={W.zoom}
			onchange={(e) => onzoom(e.currentTarget.value as BucketKind)}
		>
			{#each ZOOMS as z (z.id)}<option value={z.id}>{z.label}</option>{/each}
		</select>
		<span class="caret"><Icon name="chevronDown" size={12} /></span>
	</label>
	<span class="unit-radios">
		<SegmentTabs
			items={UNITS}
			value={unit}
			onchange={onunit}
			label={W.unit}
			prefix="heat-unit-{scope}"
			kind="radios"
		/>
	</span>
	<!-- A phone: one button that switches the unit (two pills do not fit 360 px beside the rest). -->
	<button
		type="button"
		class="chip unit-toggle"
		data-testid="heat-unit-toggle"
		aria-label="{unit === 'hours' ? W.unitHours : W.unitPercent}: {unit === 'hours'
			? W.unitHint.percent
			: W.unitHint.hours}"
		onclick={() => onunit(unit === 'hours' ? 'percent' : 'hours')}
	>
		{unit === 'hours' ? W.unitHours : W.unitPercent}
	</button>
	<ThresholdsPopover {thresholds} onchange={onthresholds} />
	<button
		type="button"
		class="chip today"
		onclick={ontoday}
		disabled={!hasToday}
		aria-label={hasToday ? W.today : W.todayOff}
	>
		<Icon name="today" size={14} /><span class="lbl">{W.today}</span>
	</button>
</div>

<!-- The selected cell's line is a live region that always exists; its pill shows only with text. -->
<p
	class="line"
	class:sr-only={selected === '' || hover !== ''}
	role="status"
	data-testid="heat-line"
>
	{selected}
</p>
{#if hover !== ''}<p class="line hover" aria-hidden="true">{hover}</p>{/if}

<div class="legend">
	<BandLegend />
	<ul class="lines" aria-label={W.legendLines}>
		{#if lines.merged}
			<li class:off={lines.today === 'off'}><i class="ln today"></i>{W.legendBoth}</li>
		{:else}
			{#if lines.today}<li class:off={lines.today === 'off'}>
					<i class="ln today"></i>{W.legendToday}
				</li>{/if}
			{#if lines.status}<li class:off={lines.status === 'off'}>
					<i class="ln status"></i>{W.legendStatus}
				</li>{/if}
		{/if}
		{#if dimmed}<li class="stale">{W.lastGood}</li>{/if}
	</ul>
</div>

<style>
	.chips {
		flex: none;
		display: flex;
		align-items: center;
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
		white-space: nowrap;
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
		outline: 3px solid var(--color-focus);
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
		display: grid;
		color: var(--color-gantt-text-muted);
		pointer-events: none;
	}
	.zoom-select,
	.unit-toggle {
		display: none;
	}
	.line {
		flex: 1 1 0;
		min-inline-size: 0;
		box-sizing: border-box;
		margin: 0;
		padding: 6px 14px;
		overflow: hidden;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		color: var(--color-gantt-text);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		text-overflow: ellipsis;
		white-space: nowrap;
		pointer-events: none;
	}
	.line:empty {
		display: none;
	}
	/* The legend: the bands, the leave stripes and the lines, in one pill. It needs a wide bar (below);
	   the thresholds panel has the bands with their rules at any width. */
	.legend {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0 0 0 auto;
		padding: 6px 12px;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		color: var(--color-gantt-text-muted);
		font-size: var(--text-xs);
		pointer-events: none;
	}
	.lines {
		display: flex;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.lines li {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		white-space: nowrap;
	}
	.lines li.off {
		font-style: italic;
	}
	.lines:not(:has(li)) {
		display: none;
	}
	.stale {
		color: var(--color-pending);
		font-weight: 600;
	}
	.ln {
		display: inline-block;
		inline-size: var(--gantt-marker-width);
		block-size: 0.9rem;
	}
	.ln.today {
		background: var(--color-today);
	}
	.ln.status {
		background: repeating-linear-gradient(
			to bottom,
			var(--color-status-date) 0 calc(var(--gantt-dash) * 1.5),
			transparent calc(var(--gantt-dash) * 1.5) calc(var(--gantt-dash) * 2.5)
		);
	}
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@media (pointer: coarse) {
		.chip {
			min-block-size: var(--size-tap);
		}
	}
	/* A bar under about 1700 px has no room for the legend beside the switcher, the chips and the
	   cell line, which gets the room; only the "last good schedule" notice, a state the user must
	   see, stays. */
	@container (max-width: 1699px) {
		.legend > :global(ul:not(.lines)) {
			display: none;
		}
		.lines li:not(.stale) {
			display: none;
		}
		.legend:not(:has(.stale)) {
			display: none;
		}
	}
	@container (max-width: 859px) {
		.today .lbl {
			display: none;
		}
		.today {
			padding-inline: 9px;
		}
	}
	/* A phone: one compact row; the line floats at the foot of the heatmap (Workload.svelte). */
	@media (max-width: 599px) {
		.zoom-radios,
		.unit-radios {
			display: none;
		}
		.unit-toggle {
			display: inline-flex;
			justify-content: center;
			min-inline-size: var(--size-tap);
		}
		.zoom-select {
			display: inline-flex;
		}
		.today {
			padding-inline: 0;
			justify-content: center;
			min-inline-size: var(--size-tap);
		}
		.today .lbl {
			display: none;
		}
		.legend {
			display: none;
		}
		.line {
			position: absolute;
			z-index: 6;
			inset-inline-start: var(--space-2);
			inset-block-end: var(--space-2);
			max-inline-size: calc(100% - 2 * var(--space-2));
			flex: none;
			box-shadow: var(--gantt-chip-shadow);
		}
	}
</style>

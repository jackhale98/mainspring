<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The heatmap's time header (phase-3.md 9.2): two rows, frozen at the top and moving with the plot
	sideways only (it sits in the scroll container with `position: sticky`, so the compositor moves
	it). Every label is DOM text, so scrolling never repaints it:
	- the upper row: months (days and weeks) or years (months), in the display serif, each in a cell
	  as wide as its group, with a label that is `position: sticky` against the name column, so a
	  group's name stays in view while it scrolls by, inside its group;
	- the lower row: the day number, the day a week starts, or the short month name, in tabular
	  figures, one per column.
	Only the groups and columns in the painted window are mounted (a few dozen). The header is
	aria-hidden: the ARIA mirror's column headers say each period in words.
-->
<script lang="ts">
	import type { AxisLabels } from '../../lib/workload/heat-labels';
	import type { HeatLine } from '../../lib/workload/heat-paint';

	interface Props {
		labels: AxisLabels | null;
		colWidth: number;
		/** The painted window's left edge and width, in content px. */
		winX: number;
		winW: number;
		width: number;
		/** The lines that stand on the header too: a small tick at the foot. */
		lines: readonly HeatLine[];
	}
	let { labels, colWidth, winX, winW, width, lines }: Props = $props();

	const first = $derived(Math.max(0, Math.floor(winX / colWidth) - 1));
	const last = $derived(Math.ceil((winX + winW) / colWidth) + 1);
	const groups = $derived(
		(labels?.major ?? []).filter((g) => g.c1 * colWidth >= winX && g.c0 * colWidth <= winX + winW),
	);
	const minors = $derived.by(() => {
		const m = labels?.minor ?? [];
		const out: Array<{ c: number; text: string }> = [];
		for (let c = first; c < Math.min(m.length, last); c++) out.push({ c, text: m[c] as string });
		return out;
	});
</script>

<div class="layer" style:width="{width}px" aria-hidden="true" data-testid="heat-header">
	<div class="months">
		{#each groups as g (g.c0)}
			<div
				class="group"
				style:left="{g.c0 * colWidth}px"
				style:width="{(g.c1 - g.c0) * colWidth}px"
			>
				<span class="label"
					>{g.name}{#if g.year !== ''}<span class="year"> {g.year}</span>{/if}</span
				>
			</div>
		{/each}
	</div>
	<div class="minors">
		{#each minors as m (m.c)}
			<span class="minor" style:left="{m.c * colWidth}px" style:width="{colWidth}px">{m.text}</span>
		{/each}
		{#each lines as l (l.kind)}
			<i class="tick {l.kind}" style:left="{l.x}px"></i>
		{/each}
	</div>
</div>

<style>
	.layer {
		position: relative;
		block-size: calc(2 * var(--load-header-row));
		background: var(--color-gantt-surface-header);
	}
	.months,
	.minors {
		position: absolute;
		inset-inline: 0;
		block-size: var(--load-header-row);
	}
	.months {
		inset-block-start: 0;
	}
	.minors {
		inset-block-start: var(--load-header-row);
	}
	.group {
		position: absolute;
		inset-block: 0;
	}
	/* Sticky against the name column: the compositor keeps the name in view, inside its group. */
	.label {
		position: sticky;
		inset-inline-start: var(--load-names-w, 0px);
		display: inline-block;
		padding-inline-start: 8px;
		color: var(--color-gantt-text);
		font-family: var(--font-display);
		font-size: 17px;
		line-height: calc(var(--load-header-row) + 2px);
		white-space: nowrap;
	}
	.year {
		color: var(--color-gantt-text-faint);
		font-style: italic;
	}
	.minor {
		position: absolute;
		inset-block: 0;
		box-sizing: border-box;
		padding-inline-start: 6px;
		overflow: hidden;
		color: var(--color-gantt-text-faint);
		font-family: var(--font-sans);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		line-height: calc(var(--load-header-row) + 2px);
		white-space: nowrap;
	}
	/* Today and the status date, at the foot of the lower row: solid and dashed, as on the plot. */
	.tick {
		position: absolute;
		inset-block-end: 0;
		inline-size: 0;
		block-size: 8px;
		border-inline-start: var(--gantt-marker-width) solid var(--color-today);
	}
	.tick.status {
		border-inline-start: var(--gantt-marker-width) dashed var(--color-status-date);
	}
</style>

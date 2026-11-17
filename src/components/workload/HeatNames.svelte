<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The heatmap's frozen name column (phase-3.md 8.1, 9.2): the people, a group's row above its
	members, level with their cells. It sits in the scroll container with `position: sticky`, so the
	compositor keeps it in view sideways; it mounts only the rows near the viewport (`first`, `last`,
	which change when a row boundary is crossed), and `contain: strict` keeps its layout out of the
	rest of the page.

	A group row has the toggle that shows or hides its members. The names are aria-hidden text: the
	ARIA mirror's row headers (HeatGrid.svelte) are what a screen reader walks, with their levels;
	the toggle is the one control here, a button with the group's name and its state.
-->
<script lang="ts">
	import { workloadStrings as W } from '../../lib/strings-workload';
	import type { LoadRow } from '../../lib/workload/types';
	import Icon from '../Icon.svelte';

	interface Props {
		rows: readonly LoadRow[];
		first: number;
		last: number;
		rowHeight: number;
		headerHeight: number;
		/** The selected cell's row, to tint its name. */
		selectedRow: number | null;
		ontoggle: (id: string) => void;
	}
	let { rows, first, last, rowHeight, headerHeight, selectedRow, ontoggle }: Props = $props();

	const shown = $derived(rows.slice(first, last));
</script>

<div class="column" data-testid="heat-names">
	<div class="corner" style:block-size="{headerHeight}px">{W.people}</div>
	<div class="rows" style:block-size="{rows.length * rowHeight}px">
		{#each shown as row, i (row.id)}
			{@const at = first + i}
			<div
				class="row"
				class:group={row.group}
				class:selected={selectedRow === at}
				style:top="{at * rowHeight}px"
				style:height="{rowHeight}px"
				style:--depth={row.depth}
				data-row={at}
			>
				{#if row.group}
					<button
						type="button"
						class="toggle"
						aria-expanded={row.expanded === true}
						aria-label={row.expanded ? W.collapse(row.name) : W.expand(row.name)}
						onclick={() => ontoggle(row.id)}
					>
						<Icon name={row.expanded ? 'chevronDown' : 'chevronRight'} size={14} />
					</button>
				{/if}
				<span class="name" aria-hidden="true" title={row.name}>{row.name}</span>
			</div>
		{/each}
	</div>
</div>

<style>
	/* Strict containment needs a size on both axes: the column is as wide as the name column and as
	   tall as the grid area it spans, so nothing inside changes the layout around it. */
	.column {
		contain: strict;
		inline-size: var(--load-names-w);
		block-size: 100%;
		border-inline-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface);
	}
	.corner {
		position: sticky;
		inset-block-start: 0;
		z-index: 2;
		box-sizing: border-box;
		display: flex;
		align-items: flex-end;
		padding: 0 8px 6px;
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface-header);
		color: var(--color-gantt-text-faint);
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.rows {
		position: relative;
	}
	.row {
		position: absolute;
		inset-inline: 0;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 2px;
		padding-inline-start: calc(6px + var(--depth, 0) * 14px);
		padding-inline-end: 6px;
		color: var(--color-gantt-text);
		font-size: var(--text-xs);
	}
	.row.group {
		font-weight: 600;
	}
	.row.selected {
		background: var(--color-gantt-row-selected);
	}
	.name {
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.toggle {
		flex: none;
		display: grid;
		place-items: center;
		inline-size: 24px;
		block-size: 100%;
		min-block-size: 24px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-gantt-text-muted);
		cursor: pointer;
	}
	.toggle:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: -3px;
		border-radius: 4px;
	}
	@media (pointer: coarse) {
		.toggle {
			inline-size: 44px;
			min-block-size: 44px;
			margin-inline-start: -10px;
		}
	}
</style>

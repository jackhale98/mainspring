<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The task column beside the timeline: one row per Gantt row, at the same height, so it scrolls
	with the bars. It is the Gantt's accessible mirror for now, an ARIA tree like the outline panel
	(levels, set sizes, roving tabindex, arrows to move and to expand or collapse, Enter to
	select), mounting only the rows near the viewport. Task T18 replaces it with the treegrid
	(OutlineGrid.svelte) that adds the date, effort, people and float columns; its props are the
	hook: rows, the mounted range and the callbacks.
-->
<script lang="ts">
	import { strings } from '../../lib/strings';
	import type { GanttRow } from '../../lib/gantt/model';

	interface Props {
		rows: readonly GanttRow[];
		/** The mounted range of rows; `last` is exclusive. */
		first: number;
		last: number;
		rowHeight: number;
		selectedKey: string | null;
		ontoggle: (key: string) => void;
		onselect: (key: string) => void;
		/** Scrolls a row into view (the rows near the viewport are the only ones mounted). */
		onreveal: (index: number) => Promise<void>;
	}
	let { rows, first, last, rowHeight, selectedKey, ontoggle, onselect, onreveal }: Props = $props();

	let focusKey = $state<string | null>(null);
	let tree: HTMLDivElement | undefined = $state();

	const shown = $derived(rows.slice(first, last));
	const tabKey = $derived(
		focusKey !== null && shown.some((r) => r.key === focusKey)
			? focusKey
			: (shown.find((r) => r.key === selectedKey)?.key ?? shown[0]?.key ?? null),
	);

	async function focusRow(index: number): Promise<void> {
		const row = rows[index];
		if (!row) return;
		focusKey = row.key;
		await onreveal(index);
		tree?.querySelector<HTMLElement>(`[data-key="${CSS.escape(row.key)}"]`)?.focus({
			preventScroll: true,
		});
	}

	function activate(row: GanttRow): void {
		focusKey = row.key;
		onselect(row.key);
	}

	function onkeydown(event: KeyboardEvent, row: GanttRow, index: number): void {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const expandable = row.expanded !== null;
		let handled = true;
		switch (event.key) {
			case 'ArrowDown':
				void focusRow(Math.min(rows.length - 1, index + 1));
				break;
			case 'ArrowUp':
				void focusRow(Math.max(0, index - 1));
				break;
			case 'Home':
				void focusRow(0);
				break;
			case 'End':
				void focusRow(rows.length - 1);
				break;
			case 'ArrowRight':
				if (expandable && !row.expanded) ontoggle(row.key);
				else if (row.expanded) void focusRow(index + 1);
				break;
			case 'ArrowLeft':
				if (row.expanded) ontoggle(row.key);
				else if (row.node.parent !== null) {
					void focusRow(rows.findIndex((r) => r.key === row.node.parent));
				}
				break;
			case 'Enter':
			case ' ':
				activate(row);
				break;
			default:
				handled = false;
		}
		if (handled) event.preventDefault();
	}

	function onclick(event: MouseEvent, row: GanttRow): void {
		focusKey = row.key;
		if ((event.target as Element).closest('.twisty') && row.expanded !== null) ontoggle(row.key);
		else onselect(row.key);
	}
</script>

<div
	bind:this={tree}
	role="tree"
	aria-label={strings.gantt.tasks}
	class="tree"
	style:height="{rows.length * rowHeight}px"
>
	{#each shown as row, i (row.key)}
		{@const n = row.node}
		<div
			role="treeitem"
			class="row"
			class:selected={selectedKey === row.key}
			data-key={row.key}
			aria-level={n.level}
			aria-posinset={n.posinset}
			aria-setsize={n.setsize}
			aria-expanded={row.expanded === null ? undefined : row.expanded}
			aria-selected={selectedKey === row.key}
			tabindex={tabKey === row.key ? 0 : -1}
			style:top="{(first + i) * rowHeight}px"
			style:height="{rowHeight}px"
			style:--depth={row.depth}
			onclick={(e) => onclick(e, row)}
			onkeydown={(e) => onkeydown(e, row, first + i)}
		>
			<span class="twisty" aria-hidden="true">
				{#if row.expanded !== null}{row.expanded ? '▾' : '▸'}{/if}
			</span>
			<span class="name" class:summary={row.kind === 'container'}>{row.name}</span>
			{#if row.textOnly}
				<span class="badge">
					{strings.outline.textOnly}<span class="sr-only">
						. {strings.outline.reason[row.textOnly]}</span
					>
				</span>
			{/if}
			{#if !row.scheduled}<span class="sr-only">. {strings.gantt.notScheduled}</span>{/if}
		</div>
	{/each}
</div>

<style>
	.tree {
		position: relative;
	}
	.row {
		position: absolute;
		inset-inline: 0;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding-inline-end: var(--space-2);
		padding-inline-start: calc(var(--space-1) + var(--depth, 0) * var(--space-4));
		border-block-end: var(--gantt-row-line-width) solid var(--color-gantt-row-line);
		cursor: pointer;
		white-space: nowrap;
		box-sizing: border-box;
		scroll-margin-block-start: calc(var(--gantt-header-row-height) * 2);
	}
	.row:hover {
		background: var(--color-gantt-row-hover);
	}
	.row.selected {
		background: var(--color-gantt-row-selected);
		box-shadow: inset 3px 0 0 var(--color-gantt-accent);
	}
	.row:focus-visible {
		outline: 3px solid var(--color-gantt-accent);
		outline-offset: -3px;
	}
	.twisty {
		flex: none;
		inline-size: 1.25rem;
		block-size: 100%;
		display: grid;
		place-items: center;
		color: var(--color-gantt-text-muted);
	}
	.name {
		flex: 1 1 auto;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--text-sm);
	}
	.name.summary {
		font-weight: 600;
	}
	.badge {
		flex: none;
		padding: 0 var(--space-1);
		border-radius: var(--radius-sm);
		background: var(--color-badge-bg);
		color: var(--color-badge-text);
		font-size: var(--text-xs);
		line-height: 1.3rem;
	}
	@media (max-width: 599px) {
		.row {
			padding-inline-start: calc(var(--space-1) + var(--depth, 0) * var(--space-2));
		}
		.badge {
			display: none;
		}
	}
	@media (pointer: coarse) {
		.twisty {
			inline-size: 1.75rem;
		}
	}
</style>

<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What a row drag draws in the task list (phase-2.md 7.1 R5): a line at the boundary where the
	row would land, indented to the depth it would have, and a label by the pointer that says where
	("Inside Design, position 2"). Placed inside the list's body so that the line is positioned
	against its rows; the label is fixed to the pointer. Both are pointer-only (aria-hidden): the
	keys and the row menu announce their moves.
-->
<script lang="ts">
	import type { RowDragView } from './row-drag.svelte';

	interface Props {
		view: RowDragView | null;
		rowHeight: number;
	}
	let { view, rowHeight }: Props = $props();
</script>

{#if view}
	<div
		class="drop-line"
		class:invalid={!view.valid}
		style:top="{view.lineRow * rowHeight}px"
		style:--depth={view.depth}
		data-testid="row-drop-line"
		aria-hidden="true"
	></div>
	<div
		class="drop-label"
		class:invalid={!view.valid}
		style:left="{view.x}px"
		style:top="{view.y}px"
		aria-hidden="true"
	>
		{view.label}
	</div>
{/if}

<style>
	.drop-line {
		position: absolute;
		z-index: 3;
		inset-inline-start: calc(var(--space-1) + var(--depth, 0) * var(--space-4));
		inset-inline-end: 0;
		block-size: 3px;
		margin-block-start: -1.5px;
		border-radius: 2px;
		background: var(--color-gantt-accent);
		pointer-events: none;
	}
	.drop-line.invalid {
		background: var(--color-gantt-text-faint);
		opacity: 0.6;
	}
	.drop-label {
		position: fixed;
		z-index: 40;
		padding: 3px var(--space-3);
		border-radius: 999px;
		background: var(--color-gantt-text);
		color: var(--color-gantt-surface);
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
		pointer-events: none;
		transform: translate(14px, -130%);
	}
	.drop-label.invalid {
		opacity: 0.75;
	}
</style>

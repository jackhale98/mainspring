<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What is inside a task's name cell in the task list (OutlineGrid.svelte): the twisty, the name or,
	while it is renamed in place (R8), a text field, the row grip that starts a row drag (R5) and
	the "text only" badge. The cell itself (its role, tab stop and width) stays the grid's, so the
	treegrid's structure is in one place; this is the part that changes with the gestures. The
	grip is a pointer's handle only (aria-hidden): the keys and the row menu do the same.
-->
<script lang="ts">
	import type { GanttRow } from '../../lib/gantt/model';
	import { gestureStrings, strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';
	import type { RowDrag } from './row-drag.svelte';

	interface Props {
		row: GanttRow;
		/** The name as the grid cell says it. */
		text: string;
		renaming: boolean;
		rowDrag?: RowDrag | undefined;
		/** Enter or blur in the rename field. */
		onrenamed: (name: string) => void;
		/** Escape in the rename field. */
		oncancel: () => void;
	}
	let { row, text, renaming, rowDrag, onrenamed, oncancel }: Props = $props();

	/** The rename field takes the focus with its text selected. */
	function startRename(node: HTMLInputElement): void {
		node.focus();
		node.select();
	}
</script>

<span class="twisty" class:leaf={row.expanded === null} aria-hidden="true">
	{#if row.expanded !== null}<span class="chevron" class:open={row.expanded}
			><Icon name="chevronRight" size={14} /></span
		>{/if}
</span>
{#if renaming}
	<input
		class="rename"
		type="text"
		value={row.name}
		aria-label={gestureStrings.row.renameLabel(row.name)}
		use:startRename
		onclick={(e) => e.stopPropagation()}
		ondblclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				onrenamed(e.currentTarget.value);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				oncancel();
			}
		}}
		onblur={(e) => onrenamed(e.currentTarget.value)}
	/>
{:else}
	<span class="label" class:summary={row.kind === 'container'}>{text}</span>
{/if}
{#if rowDrag && !renaming}
	<span
		class="grip"
		aria-hidden="true"
		data-testid="row-grip"
		onpointerdown={(e) => {
			if (e.button === 0) rowDrag.down(e, row.key);
		}}
		onclick={(e) => e.stopPropagation()}
	>
		<Icon name="grip" size={14} />
	</span>
{/if}
{#if row.textOnly}
	<span class="badge">
		{strings.outline.textOnly}<span class="sr-only"> . {strings.outline.reason[row.textOnly]}</span>
	</span>
{/if}

<style>
	.chevron {
		display: inline-grid;
		transition: transform var(--motion-fast);
	}
	.chevron.open {
		transform: rotate(90deg);
	}
	/* A target of 24 px for a fine pointer, 44 px for a coarse one (WCAG 2.5.8). */
	.twisty {
		flex: none;
		inline-size: 1.5rem;
		block-size: 100%;
		display: grid;
		place-items: center;
		color: var(--color-gantt-text-muted);
	}
	.label {
		flex: 1 1 auto;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.label.summary {
		font-weight: 600;
	}
	.rename {
		flex: 1 1 auto;
		min-inline-size: 0;
		block-size: calc(100% - 8px);
		box-sizing: border-box;
		padding: 0 var(--space-2);
		border: 2px solid var(--color-gantt-accent);
		border-radius: var(--radius-sm);
		background: var(--color-gantt-surface);
		color: var(--color-gantt-text);
		font: inherit;
	}
	/* The row grip: a pointer's handle at the end of the name, a 24 px target (44 px coarse). It
	   shows on the row under a mouse, the focused row and the selected one; a finger gets it on
	   the selected row only (the name column of a phone is narrow). */
	.grip {
		flex: none;
		display: none;
		place-items: center;
		inline-size: 24px;
		block-size: 100%;
		margin-inline-start: auto;
		color: var(--color-gantt-text-faint);
		cursor: grab;
		touch-action: pan-y;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	:global(.row:hover) .grip,
	:global(.row:focus-within) .grip,
	:global(.row.selected) .grip {
		display: grid;
	}
	.grip:hover {
		color: var(--color-gantt-text);
	}
	.badge {
		flex: none;
		padding: 0 var(--space-1);
		background: var(--color-badge-bg);
		color: var(--color-badge-text);
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		line-height: 1.3rem;
	}
	@media (max-width: 599px) {
		/* A phone has little room: a slot for the chevron only on rows that have one, and smaller
		   text. */
		.twisty.leaf {
			display: none;
		}
		/* Names may take two lines at 12.5 px, as in the phone design. */
		.label {
			font-size: 0.78rem;
			line-height: 1.2;
			white-space: normal;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			-webkit-box-orient: vertical;
		}
		/* The badge is not drawn on a phone, but its words ("text only" and the reason) stay for
		   screen readers: hidden visually, not display: none (WCAG 1.3.1). */
		.badge {
			position: absolute;
			inline-size: 1px;
			block-size: 1px;
			padding: 0;
			overflow: hidden;
			clip-path: inset(50%);
		}
	}
	@media (pointer: coarse) {
		.twisty {
			inline-size: 2.75rem;
		}
		/* A finger's grip is a 44 px target, on the selected row only. */
		:global(.row:hover:not(.selected)) .grip,
		:global(.row:focus-within:not(.selected)) .grip {
			display: none;
		}
		.grip {
			inline-size: 44px;
		}
	}
	/* On a phone 44 px would take a third of the column: the twisty is 32 px, still over WCAG
	   2.5.8's 24 px, and the whole row is a larger target for selecting. */
	@media (pointer: coarse) and (max-width: 599px) {
		.twisty {
			inline-size: 2rem;
		}
	}
</style>

<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The people palette (phase-2.md 7.1 R6, 9.2): the plan's people as chips above the chart, to drag
	onto a bar. Dropping a chip books that person on the task (`assign`, one text patch, one undo
	step); the bar under the pointer is outlined while it moves (the Gantt draws it) and a label
	names the booking. The same booking from the keyboard is the chip itself: with a task selected,
	Enter or Space books the person, or releases them when they are already on it (the chip says
	which with `aria-pressed`); the people in the details sheet are the touch path (this panel is
	for a mouse and a pen, so a coarse pointer does not show it). The drag is `chip-drag.svelte.ts`
	on the shared gesture controller; nothing here changes the plan itself.
-->
<script module lang="ts">
	export interface Person {
		readonly id: string;
		readonly name: string;
		/** The person's place in the plan's resource list: picks the avatar colour. */
		readonly index: number;
	}
</script>

<script lang="ts">
	import type { ChipDrag } from './chip-drag.svelte';
	import { gestureStrings } from '../../lib/strings';

	interface Props {
		people: readonly Person[];
		/** The people booked on the selected task (own or inherited), by id. */
		booked: ReadonlySet<string>;
		/** Whether a task is selected, for the keyboard path. */
		hasTask: boolean;
		drag: ChipDrag;
		/** Enter or Space on a chip. */
		onbook: (person: Person) => void;
	}
	let { people, booked, hasTask, drag, onbook }: Props = $props();

	const initials = (name: string): string =>
		name
			.split(/\s+/)
			.map((w) => w[0] ?? '')
			.join('')
			.slice(0, 2)
			.toUpperCase();
	const colour = (i: number): number => (i % 6) + 1;
	const uid = $props.id();
	const ghost = $derived(drag.view ? people[drag.view.chip] : undefined);
</script>

<section class="palette" aria-label={gestureStrings.palette.region} data-testid="people-palette">
	<p class="sr-only" id="{uid}-hint">{gestureStrings.palette.hint}</p>
	{#if people.length === 0}
		<p class="none">{gestureStrings.palette.none}</p>
	{:else}
		<ul>
			{#each people as p, i (p.id)}
				<li>
					<button
						type="button"
						class="chip"
						class:booked={booked.has(p.id)}
						data-person={p.id}
						style:--bg="var(--color-gantt-avatar-{colour(p.index)}-bg)"
						style:--ink="var(--color-gantt-avatar-{colour(p.index)}-ink)"
						aria-pressed={hasTask ? booked.has(p.id) : undefined}
						title={gestureStrings.palette.chip(p.name)}
						aria-describedby="{uid}-hint"
						onpointerdown={(e) => {
							if (e.button === 0) drag.down(e, i);
						}}
						onclick={(e) => {
							// A mouse click is the end of a drag or a slip; Enter and Space have no position.
							if (e.detail === 0 && hasTask) onbook(p);
						}}
					>
						<span class="avatar" aria-hidden="true">{initials(p.name)}</span>
						<span class="name">{p.name}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if drag.view && ghost}
	<div class="ghost" style:left="{drag.view.x}px" style:top="{drag.view.y}px" aria-hidden="true">
		<span
			class="avatar"
			style:--bg="var(--color-gantt-avatar-{colour(ghost.index)}-bg)"
			style:--ink="var(--color-gantt-avatar-{colour(ghost.index)}-ink)">{initials(ghost.name)}</span
		>
		{ghost.name}
	</div>
{/if}

<style>
	.palette {
		flex: none;
		padding: 6px 14px;
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface);
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.none {
		margin: 0;
		color: var(--color-gantt-text-muted);
		font-size: var(--text-xs);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		/* 24 px at least (WCAG 2.5.8); the chip is a drag source and a toggle. */
		min-block-size: 28px;
		padding: 2px var(--space-3) 2px 3px;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		color: var(--color-gantt-text);
		font: inherit;
		font-size: var(--text-xs);
		cursor: grab;
		/* A press on a chip is a drag, not a text selection. */
		user-select: none;
		touch-action: none;
	}
	.chip:hover {
		background: var(--color-gantt-inset);
	}
	.chip:focus-visible {
		outline: 3px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	.chip.booked {
		border-color: var(--color-gantt-accent);
		box-shadow: inset 0 0 0 1px var(--color-gantt-accent);
		font-weight: 600;
	}
	.avatar {
		display: inline-grid;
		place-items: center;
		inline-size: 22px;
		block-size: 22px;
		border-radius: 50%;
		background: var(--bg);
		color: var(--ink);
		font-size: 9.5px;
		font-weight: 700;
	}
	.ghost {
		position: fixed;
		z-index: 40;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 2px var(--space-3) 2px 3px;
		border: 1px solid var(--color-gantt-accent);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		box-shadow: var(--shadow-panel);
		color: var(--color-gantt-text);
		font-size: var(--text-xs);
		font-weight: 600;
		pointer-events: none;
		transform: translate(10px, 10px);
	}
	/* A finger books people from the details sheet; the palette is for a mouse and a pen. */
	@media (pointer: coarse) {
		.palette {
			display: none;
		}
	}
</style>

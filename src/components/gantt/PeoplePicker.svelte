<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The people picker (phase-2.md 7.1 R6; polish item 17): one toolbar control in place of a wall of
	chips. The "Assign" button opens a searchable list (PeopleList.svelte: an ARIA combobox with a
	listbox, filtered by name or id). A person leaves the list in one of three ways:
	- dragged onto a bar (mouse and pen; `chip-drag.svelte.ts`, the drag the chips had): the list
	  hides while the person is in the air, so the bars are in view, and closes on the drop;
	- clicked: assign mode starts, the button says "Assigning <name>…" beside a Done button, and
	  each click on a bar books that person (the Gantt does that; Escape or Done ends it). The
	  button still opens the list, to switch person;
	- Enter with a task selected: books the person on that task at once, the keyboard's answer to
	  the drag (WCAG 2.5.7); with no task selected Enter starts assign mode like a click does.
	The last people used stay as small chips beside the button, to repeat a drag (not in a narrow
	chart, and not in assign mode). A finger books people in the details sheet, so a coarse
	pointer does not show this control. Nothing here changes the plan.
-->
<script lang="ts">
	import { gestureStrings } from '../../lib/strings';
	import Icon from '../Icon.svelte';
	import { avatarColour, initials } from './avatar';
	import type { ChipDrag } from './chip-drag.svelte';
	import PeopleList from './PeopleList.svelte';
	import type { Person } from './types';

	interface Props {
		people: readonly Person[];
		/** The people booked on the selected task (own or inherited), by id. */
		booked: ReadonlySet<string>;
		/** Whether a task is selected, for the keyboard path. */
		hasTask: boolean;
		drag: ChipDrag;
		/** The last people used, newest first. */
		recent: readonly Person[];
		/** The person assign mode is booking, or null. */
		assigning: Person | null;
		/** A click on a person: assign mode. */
		onpick: (person: Person) => void;
		/** Enter on a person: the selected task takes them (assign mode when none is selected). */
		onpickkey: (person: Person) => void;
		/** Done. */
		ondone: () => void;
	}
	let { people, booked, hasTask, drag, recent, assigning, onpick, onpickkey, ondone }: Props =
		$props();

	const S = gestureStrings.palette;
	const uid = $props.id();
	let open = $state(false);
	let alignEnd = $state(false);
	let root: HTMLDivElement | undefined = $state();
	let button: HTMLButtonElement | undefined = $state();

	const ghost = $derived(drag.view ? people[drag.view.chip] : undefined);
	const indexOf = (p: Person): number => people.findIndex((q) => q.id === p.id);

	function show(): void {
		// Open towards the side that has the room: a button near the right edge of a narrow chart.
		const chart = root?.closest('[data-testid="gantt"]')?.getBoundingClientRect();
		const at = button?.getBoundingClientRect();
		alignEnd = !!chart && !!at && at.left + 336 > chart.right;
		open = true;
	}
	function close(refocus: boolean): void {
		open = false;
		if (refocus) button?.focus();
	}
	function choose(p: Person, byKey: boolean): void {
		close(byKey);
		if (byKey) onpickkey(p);
		else onpick(p);
	}
	function onwindowdown(e: PointerEvent): void {
		if (open && !drag.dragging && e.target instanceof Node && !root?.contains(e.target))
			close(false);
	}
	// A drag that ends (a drop or a cancel) closes the list that it began from.
	let dragging = false;
	$effect(() => {
		const now = drag.dragging;
		if (dragging && !now && open) {
			open = false;
			button?.focus();
		}
		dragging = now;
	});
	// A press on a recent chip that moved was a drag, not a click.
	let downAt = { x: 0, y: 0 };
</script>

<svelte:window onpointerdown={onwindowdown} />

<div
	class="picker"
	class:assigning={assigning !== null}
	bind:this={root}
	data-testid="people-picker"
>
	<button
		bind:this={button}
		type="button"
		class="chip assign"
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-controls={open ? `${uid}-panel` : undefined}
		aria-describedby="{uid}-hint"
		aria-label={assigning ? S.assigning(assigning.name) : undefined}
		title={assigning ? S.switchTitle : S.assignTitle}
		data-testid="assign-button"
		onclick={() => (open ? close(false) : show())}
		onkeydown={(e) => {
			if (e.key === 'ArrowDown' && !open) {
				e.preventDefault();
				show();
			}
		}}
	>
		<Icon name="users" size={14} />
		{#if assigning}
			<!-- Assign mode: the button says who is being assigned (and still opens the list, to switch). -->
			<span class="lbl who" data-testid="assign-mode">{S.assigning(assigning.name)}</span>
		{:else}
			<span class="lbl">{S.assign}</span>
		{/if}
	</button>
	<p class="sr-only" id="{uid}-hint">{S.hint}</p>

	{#if assigning}
		<button type="button" class="done" aria-label={S.doneLabel} onclick={ondone}>{S.done}</button>
	{:else if recent.length > 0}
		<ul class="recent" aria-label={S.recentRegion}>
			{#each recent as p (p.id)}
				<li>
					<button
						type="button"
						class="rchip"
						data-recent={p.id}
						style:--bg="var(--color-gantt-avatar-{avatarColour(p.index)}-bg)"
						style:--ink="var(--color-gantt-avatar-{avatarColour(p.index)}-ink)"
						aria-label={p.name}
						aria-describedby="{uid}-hint"
						title={S.recent(p.name)}
						onpointerdown={(e) => {
							if (e.button !== 0) return;
							downAt = { x: e.clientX, y: e.clientY };
							drag.down(e, indexOf(p));
						}}
						onclick={(e) => {
							// Enter and Space have no position; a mouse press that moved was a drag.
							if (e.detail === 0) onpickkey(p);
							else if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) <= 4) onpick(p);
						}}
					>
						<span class="avatar" aria-hidden="true">{initials(p.name)}</span>
						<span class="name">{p.name}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if open}
		<PeopleList
			id="{uid}-panel"
			{people}
			{booked}
			{hasTask}
			{drag}
			{alignEnd}
			onchoose={choose}
			onclose={close}
		/>
	{/if}
</div>

{#if drag.view && ghost}
	<div class="ghost" style:left="{drag.view.x}px" style:top="{drag.view.y}px" aria-hidden="true">
		<span
			class="avatar"
			style:--bg="var(--color-gantt-avatar-{avatarColour(ghost.index)}-bg)"
			style:--ink="var(--color-gantt-avatar-{avatarColour(ghost.index)}-ink)"
			>{initials(ghost.name)}</span
		>
		{ghost.name}
	</div>
{/if}

<style>
	.picker {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-inline-size: 0;
	}
	/* The toolbar's own pill (the same look as its siblings: GanttToolbar.svelte `.chip`). */
	.chip {
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
		backdrop-filter: blur(6px);
		cursor: pointer;
	}
	.chip:hover {
		background: var(--color-gantt-inset);
	}
	.chip[aria-expanded='true'] {
		border-color: var(--color-gantt-accent);
		box-shadow: inset 0 0 0 1px var(--color-gantt-accent);
	}
	button:focus-visible {
		outline: 2px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		inline-size: 20px;
		block-size: 20px;
		border-radius: 50%;
		background: var(--bg);
		color: var(--ink);
		font-size: 9px;
		font-weight: 700;
	}
	/* The recent people: small chips to drag again. They need room that the legend and the task
	   line would otherwise have: hidden in a chart under 1350 px, only the avatars under 1600. */
	.recent {
		display: none;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	@container gantt (min-width: 1350px) {
		.recent {
			display: flex;
		}
	}
	.rchip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		max-inline-size: 7rem;
		block-size: 26px;
		padding: 2px 3px;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		color: var(--color-gantt-text);
		font: inherit;
		font-size: var(--text-xs);
		cursor: grab;
		user-select: none;
		touch-action: none;
	}
	.rchip:hover {
		background: var(--color-gantt-inset);
	}
	.rchip .name {
		display: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@container gantt (min-width: 1600px) {
		.rchip {
			padding-inline-end: var(--space-2);
		}
		.rchip .name {
			display: inline;
		}
	}
	/* Assign mode: the button and Done make one accent pill that says who is being assigned. */
	.picker.assigning {
		gap: 0;
		block-size: var(--gantt-chip-height);
		padding-inline-end: 3px;
		border: 1px solid var(--color-gantt-accent);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		box-shadow: inset 0 0 0 1px var(--color-gantt-accent);
	}
	.picker.assigning .assign {
		min-inline-size: 0;
		padding-inline: 12px 8px;
		border: 0;
		background: transparent;
		box-shadow: none;
		backdrop-filter: none;
		font-weight: 600;
	}
	.assign .who {
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.done {
		flex: none;
		block-size: calc(var(--gantt-chip-height) - 8px);
		padding-inline: 10px;
		border: 0;
		border-radius: 999px;
		background: var(--color-gantt-accent);
		color: var(--color-gantt-accent-text);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.done:hover {
		filter: brightness(1.08);
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
	/* A narrow chart (Split, or a desktop with the details docked) has no room for the word: the
	   icon is the control. */
	@container gantt (max-width: 1049px) {
		.assign .lbl {
			display: none;
		}
		.assign {
			padding-inline: 9px;
		}
		/* Assign mode keeps its words (who is being assigned) in a shorter pill. */
		.picker.assigning .assign .who {
			display: inline;
			max-inline-size: 7.5rem;
		}
		.picker.assigning .assign {
			padding-inline: 10px 6px;
		}
	}
	/* A finger books people from the details sheet; this control is for a mouse and a pen. */
	@media (pointer: coarse) {
		.picker {
			display: none;
		}
	}
</style>

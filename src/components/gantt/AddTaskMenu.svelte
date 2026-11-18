<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Add task (+) control (phase-3.md 9.8; ADR-0013), first in the Gantt's toolbar on every
	layout. With no task selected (or in an empty plan) it is a plain button that adds at the end of
	the plan. With a task selected it opens a menu of two items, "Add task after" (focused first,
	the default) and "Add subtask". It only reports the choice: the Gantt sends the edit and opens
	the details. The list and its keys are the shared Menu's (ui/Menu.svelte). A phone shows the plus alone
	(its name is the button's accessible name); the label shows where there is room for it.
-->
<script lang="ts">
	import type { AddMode } from '../../lib/gantt/add-task';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';
	import Menu, { type MenuItem } from '../ui/Menu.svelte';

	interface Props {
		/** A task is selected: the button opens the choices instead of adding at once. */
		hasSelection: boolean;
		/** Sends the edit; the control ignores presses until the promise settles. */
		onadd: (mode: AddMode) => Promise<unknown> | void;
		/** The selected task can take a subtask; otherwise that item says why it is off. */
		canSubtask?: boolean;
		/** Which edge of the button the menu lines up with: `end` where the button is at the right. */
		align?: 'start' | 'end';
	}
	let { hasSelection, onadd, canSubtask = true, align = 'start' }: Props = $props();

	const S = strings.gantt.add;
	let open = $state(false);

	const items = $derived<readonly MenuItem[]>([
		{ id: 'after', label: S.after },
		{
			id: 'subtask',
			label: S.subtask,
			unavailable: !canSubtask,
			...(canSubtask ? {} : { hint: S.noSubtask }),
		},
	]);

	/** An add is on its way (the edit, then the result): another press would add a second task. */
	let busy = $state(false);
	async function go(mode: AddMode): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await onadd(mode);
		} finally {
			busy = false;
		}
	}
	function choose(id: string): void {
		if (busy || (id === 'subtask' && !canSubtask)) return;
		void go(id as AddMode);
	}
	// The selection went away while the menu was open: nothing to choose between.
	$effect(() => {
		if (!hasSelection) open = false;
	});
</script>

<Menu bind:open {items} label={S.menu} onselect={choose} {align}>
	{#snippet trigger({ attrs, toggle })}
		<button
			type="button"
			class="chip primary"
			data-narrow="icon"
			{...hasSelection ? attrs : { 'data-menu-trigger': true }}
			aria-label={S.label}
			aria-disabled={busy ? 'true' : undefined}
			aria-busy={busy ? 'true' : undefined}
			title={hasSelection ? S.hintMenu : S.hintEnd}
			data-testid="add-task"
			onclick={() => {
				if (busy) return;
				if (hasSelection) toggle();
				else void go('after');
			}}
		>
			<Icon name="plus" size={16} stroke={2.2} /><span class="lbl">{S.label}</span>
		</button>
	{/snippet}
</Menu>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		block-size: var(--gantt-chip-height);
		min-inline-size: var(--gantt-chip-height);
		padding-inline: 12px;
		border: 1px solid var(--color-gantt-accent);
		border-radius: 999px;
		background: var(--color-gantt-accent);
		box-shadow: var(--gantt-chip-shadow);
		color: var(--color-gantt-accent-text);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.chip:hover {
		filter: brightness(1.08);
	}
	.chip:focus-visible {
		outline: 3px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	.chip[aria-disabled='true'] {
		opacity: 0.6;
		cursor: default;
	}
	/* No room for the word (a narrow chart, a phone, the Plan tab): the plus is the button
	   (data-narrow="icon": src/styles/toolbar.css). */
	@media (pointer: coarse) {
		.chip {
			min-block-size: var(--size-tap);
			min-inline-size: var(--size-tap);
		}
	}
</style>

<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A row of choices that switches what one panel shows (phase-3.md 9.1, 10; 18.10): the view
	switcher of the desktop and tablet toolbars (Gantt, Workload, Resources, Calendar) and the
	segments of the phone's People tab (Load, Lanes, Calendar, Team). One tab stop (roving
	tabindex), ArrowLeft and ArrowRight (and Up and Down) move and choose, Home and End go to the
	ends. The choice is made as the focus reaches it (it is a view of the same plan, so it costs
	nothing), and `onchange` hears it. Targets are 44 px on a coarse pointer.

	- `kind` "tabs" (the phone's segments): a tablist whose panel is the area under it
	  (`controls`, and the tab ids are `${prefix}-${id}`).
	- `kind` "radios" (the toolbars' switcher): a radio group. The switcher sits inside the very
	  panel it changes (the toolbar of the Gantt, or of a People view), so it is not a tablist.
	  `data-choice` carries the id, for the switcher's focus return after a change of view.

	`variant` "pill" is the toolbar's floating pill (the mode switch's look: ADR-0009, the active one
	a dark enamel pill with a steel marker). "block" is the phone's segmented control: the choices
	share the row, each with its icon above its label like the tab bar, so that "Calendar" fits at
	360 px. In a narrow toolbar the inactive pill choices keep only their icon (the name stays in
	the DOM); the container is the nearest one (the Gantt, or a People view's bar).
-->
<script lang="ts" generics="T extends string">
	import { tick } from 'svelte';
	import type { IconName } from '../../lib/icons';
	import Icon from '../Icon.svelte';

	interface Item {
		readonly id: T;
		readonly label: string;
		readonly icon?: IconName;
	}
	interface Props {
		items: readonly Item[];
		value: T;
		/** Called with the choice the user made. */
		onchange: (id: T) => void;
		/** The group's accessible name. */
		label: string;
		/** Ids are `${prefix}-${id}`. */
		prefix: string;
		kind?: 'tabs' | 'radios';
		/** Tabs only: the id of the panel they control. */
		controls?: string;
		variant?: 'pill' | 'block';
		/**
		 * Called after a choice made by a click or a key, to put the focus on the chosen one itself:
		 * the owner's, when the choice swaps the panel the group is in for one with its own copy of it
		 * (the Gantt's toolbar and a People view's). Without it a key moves the focus to the chosen
		 * choice here, and a click leaves it where it is.
		 */
		refocus?: ((id: T) => void) | undefined;
	}
	let {
		items,
		value,
		onchange,
		label,
		prefix,
		kind = 'tabs',
		controls,
		variant = 'pill',
		refocus,
	}: Props = $props();

	const radios = $derived(kind === 'radios');

	async function onkeydown(event: KeyboardEvent): Promise<void> {
		const at = items.findIndex((i) => i.id === value);
		let next = at;
		const last = items.length - 1;
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = at >= last ? 0 : at + 1;
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = at <= 0 ? last : at - 1;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = last;
		else return;
		event.preventDefault();
		const item = items[next];
		if (!item) return;
		onchange(item.id);
		if (refocus) {
			refocus(item.id);
			return;
		}
		await tick();
		document.getElementById(`${prefix}-${item.id}`)?.focus();
	}
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
	class="tabs"
	data-variant={variant}
	role={radios ? 'radiogroup' : 'tablist'}
	aria-label={label}
	{onkeydown}
>
	{#each items as item (item.id)}
		<button
			type="button"
			role={radios ? 'radio' : 'tab'}
			id="{prefix}-{item.id}"
			data-choice={item.id}
			aria-checked={radios ? value === item.id : undefined}
			aria-selected={radios ? undefined : value === item.id}
			aria-controls={radios ? undefined : controls}
			tabindex={value === item.id ? 0 : -1}
			onclick={() => {
				onchange(item.id);
				refocus?.(item.id);
			}}
		>
			{#if item.icon}<Icon name={item.icon} size={15} />{/if}
			<span class="label">{item.label}</span>
		</button>
	{/each}
</div>

<style>
	.tabs {
		display: inline-flex;
		gap: 2px;
		padding: 4px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
	}
	.tabs[data-variant='block'] {
		display: flex;
		inline-size: 100%;
		box-sizing: border-box;
		border-radius: 20px;
	}
	button {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-block-size: 30px;
		min-inline-size: 0;
		padding-inline: 14px;
		border: 0;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--color-text-muted);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--motion-fast),
			color var(--motion-fast);
	}
	/* The phone's segments: the icon above the label, as the tab bar has it. */
	.tabs[data-variant='block'] button {
		flex: 1 1 0;
		flex-direction: column;
		gap: 3px;
		min-block-size: var(--size-tap);
		padding: 6px 2px;
		border-radius: 16px;
		font-size: 12px;
	}
	button:hover:not([aria-selected='true'], [aria-checked='true']) {
		background: var(--color-row-hover);
		color: var(--color-text);
	}
	button[aria-selected='true'],
	button[aria-checked='true'] {
		background: var(--color-pill-on);
		color: var(--color-pill-on-ink);
		font-weight: 600;
	}
	/* The steel marker: thin, under the label, like a watch hand's tip (ModeSwitch). */
	.tabs[data-variant='pill'] button[aria-selected='true']::after,
	.tabs[data-variant='pill'] button[aria-checked='true']::after {
		content: '';
		position: absolute;
		inset-block-end: 3px;
		inset-inline: 50%;
		inline-size: 14px;
		block-size: 2px;
		margin-inline-start: -7px;
		border-radius: 1px;
		background: var(--color-pill-marker);
	}
	button:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		button {
			min-block-size: var(--size-tap);
			min-inline-size: var(--size-tap);
		}
	}
	/* A narrower toolbar keeps the icons, and the label of the chosen one only. */
	@container (max-width: 1379px) {
		.tabs[data-variant='pill'] button:not([aria-selected='true'], [aria-checked='true']) .label {
			position: absolute;
			inline-size: 1px;
			block-size: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.tabs[data-variant='pill'] button:not([aria-selected='true'], [aria-checked='true']) {
			padding-inline: 11px;
		}
	}
</style>

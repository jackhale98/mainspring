<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A row of tabs that switches what one panel shows (phase-3.md 9.1, 10; 18.10): the desktop and
	tablet view switcher (Gantt, Workload, Resources, Calendar) and the segments of the phone's
	People tab (Load, Lanes, Calendar, Team). A WAI-ARIA tablist: one tab stop (roving tabindex),
	ArrowLeft and ArrowRight (and Up and Down) move and select, Home and End go to the ends. The tab
	is selected as the focus reaches it (the panel is a view of the same plan, so showing it costs
	nothing), and the focus stays on the tab that was chosen: the controlled panel is the next stop
	for Tab, and `onchange` is the owner's to announce. Targets are 44 px on a coarse pointer.

	`variant` "pill" is the desktop switcher (a floating pill, the mode switch's look: ADR-0009, the
	active tab a dark enamel pill with a steel marker); "block" is the phone's segmented control, the
	tabs sharing the row's width. In a narrow bar the inactive pill tabs keep only their icon, with
	their names still in the DOM.
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
		/** Called with the tab the user chose. */
		onchange: (id: T) => void;
		/** The tablist's accessible name. */
		label: string;
		/** Tab ids are `${prefix}-${id}`; the panel names the active one in `aria-labelledby`. */
		prefix: string;
		/** The id of the panel the tabs control. */
		controls: string;
		variant?: 'pill' | 'block';
	}
	let { items, value, onchange, label, prefix, controls, variant = 'pill' }: Props = $props();

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
		await tick();
		document.getElementById(`${prefix}-${item.id}`)?.focus();
	}
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tabs" data-variant={variant} role="tablist" aria-label={label} {onkeydown}>
	{#each items as item (item.id)}
		<button
			type="button"
			role="tab"
			id="{prefix}-{item.id}"
			aria-selected={value === item.id}
			aria-controls={controls}
			tabindex={value === item.id ? 0 : -1}
			onclick={() => onchange(item.id)}
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
		cursor: pointer;
		transition:
			background-color var(--motion-fast),
			color var(--motion-fast);
	}
	.tabs[data-variant='block'] button {
		flex: 1 1 0;
		padding-inline: 4px;
	}
	button:hover:not([aria-selected='true']) {
		background: var(--color-row-hover);
		color: var(--color-text);
	}
	button[aria-selected='true'] {
		background: var(--color-pill-on);
		color: var(--color-pill-on-ink);
		font-weight: 600;
	}
	/* The steel marker: thin, under the label, like a watch hand's tip (ModeSwitch). */
	button[aria-selected='true']::after {
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
	/* A narrow bar (Split beside the editor) keeps the icons, and the label of the active tab. */
	@container views (max-width: 519px) {
		.tabs[data-variant='pill'] button:not([aria-selected='true']) .label {
			position: absolute;
			inline-size: 1px;
			block-size: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.tabs[data-variant='pill'] button:not([aria-selected='true']) {
			padding-inline: 11px;
		}
	}
</style>

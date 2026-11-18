<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Row actions (phase-2.md 7.1 R5, 10.2; WCAG 2.5.7): the commands of the selected task as buttons,
	for a pointer that cannot drag and for anyone who does not know the keys: move up and down,
	indent and outdent, rename, add after, delete. They call the same commands as the keys
	(interactions.svelte.ts), so each is one text patch and one undo step. The button draws here;
	the list and its keys are the shared Menu (ui/Menu.svelte), with a last item that opens the
	shortcuts list.
-->
<script lang="ts">
	import type { RowAction } from './types';
	import { SHORTCUTS } from '../../lib/gantt/keys';
	import { gestureStrings } from '../../lib/strings';
	import Icon from '../Icon.svelte';
	import Menu, { type MenuItem } from '../ui/Menu.svelte';

	interface Props {
		actions: readonly RowAction[];
		/** No task is selected: the button says so and does not open. */
		disabled: boolean;
		onaction: (id: string) => void;
	}
	let { actions, disabled, onaction }: Props = $props();

	const uid = $props.id();
	let button: HTMLButtonElement | undefined = $state();
	let help: HTMLDialogElement | undefined = $state();

	const items = $derived<readonly MenuItem[]>([
		...actions,
		{ id: 'shortcuts', label: gestureStrings.row.shortcuts, separator: true },
	]);

	function choose(id: string): void {
		if (id === 'shortcuts') help?.showModal();
		else onaction(id);
	}
</script>

<Menu {items} label={gestureStrings.row.menu} onselect={choose}>
	{#snippet trigger({ attrs, toggle })}
		<button
			bind:this={button}
			type="button"
			class="chip"
			data-narrow="fixed"
			{...attrs}
			aria-label={gestureStrings.row.menu}
			title={gestureStrings.row.menu}
			{disabled}
			data-testid="row-menu"
			onclick={toggle}
		>
			<Icon name="more" size={16} />
		</button>
	{/snippet}
</Menu>

<!-- The shortcuts list: the same keys as the menu, for anyone who wants them in one place. -->
<dialog
	bind:this={help}
	class="help"
	data-testid="shortcuts"
	aria-labelledby="{uid}-help"
	onclose={() => button?.focus()}
>
	<h2 id="{uid}-help">{gestureStrings.keys.title}</h2>
	<p>{gestureStrings.keys.intro}</p>
	<dl>
		{#each SHORTCUTS as k (k.id)}
			<dt>{gestureStrings.keys.label[k.id]}</dt>
			<dd><kbd>{k.show}</kbd></dd>
		{/each}
	</dl>
	<form method="dialog">
		<button type="submit">{gestureStrings.keys.close}</button>
	</form>
</dialog>

<style>
	.chip {
		display: inline-grid;
		place-items: center;
		inline-size: var(--gantt-chip-height);
		block-size: var(--gantt-chip-height);
		padding: 0;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		box-shadow: var(--gantt-chip-shadow);
		color: var(--color-gantt-text);
		cursor: pointer;
	}
	.chip:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.chip:hover:not(:disabled) {
		background: var(--color-gantt-inset);
	}
	.chip:focus-visible {
		outline: 3px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	.help {
		inline-size: min(28rem, calc(100vw - 2 * var(--gutter)));
		padding: var(--space-6);
		border: 0;
		border-radius: var(--radius-panel);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-panel);
	}
	.help::backdrop {
		background: rgb(0 0 0 / 0.35);
	}
	.help h2 {
		margin: 0 0 var(--space-2);
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 400;
	}
	.help p {
		margin: 0 0 var(--space-3);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.help dl {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-2) var(--space-4);
		margin: 0 0 var(--space-4);
		font-size: var(--text-sm);
	}
	.help dd {
		margin: 0;
	}
	.help form button {
		min-block-size: var(--size-control);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	.help form button:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.chip {
			min-inline-size: var(--size-tap);
			min-block-size: var(--size-tap);
		}
	}
</style>

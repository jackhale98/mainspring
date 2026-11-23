<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The "More actions" menu, the toolbar's "…" (phase-2.md 7.1 R5, 10.2; WCAG 2.5.7). First the
	commands of the selected task as buttons, for a pointer that cannot drag and for anyone who does
	not know the keys: move up and down, indent and outdent, rename, add after, delete. They call the
	same commands as the keys (interactions.svelte.ts), so each is one text patch and one undo step;
	with no task selected they are there but off. Then the two exports of the chart (phase-4.md 18.20:
	the picture and the tasks as CSV), which need no selection, and a last item that opens the
	shortcuts list. The button draws here; the list and its keys are the shared Menu (ui/Menu.svelte).
-->
<script lang="ts">
	import type { ExportEntries, RowAction } from './types';
	import { SHORTCUTS } from '../../lib/gantt/keys';
	import { gestureStrings } from '../../lib/strings';
	import Icon from '../Icon.svelte';
	import Menu, { type MenuItem } from '../ui/Menu.svelte';

	interface Props {
		actions: readonly RowAction[];
		/** No task is selected: the menu has no row actions (the exports and the shortcuts stay). */
		disabled: boolean;
		onaction: (id: string) => void;
		/** The exports: which can be chosen now, and what choosing one does (none: no entries). */
		exports?: ExportEntries | undefined;
	}
	let { actions, disabled, onaction, exports }: Props = $props();

	const uid = $props.id();
	let button: HTMLButtonElement | undefined = $state();
	let help: HTMLDialogElement | undefined = $state();

	const R = gestureStrings.row;
	let open = $state(false);
	// The export's code is fetched while the menu is open, ready for a choice (a first load has none of it).
	$effect(() => {
		if (open) exports?.prefetch();
	});
	/** An export entry: reachable while it cannot be chosen, and then says why (its hint). */
	const exportItem = (id: 'png' | 'csv', label: string, first: boolean): MenuItem => {
		const why = exports?.[id] ?? null;
		return {
			id: `export-${id}`,
			label,
			separator: first,
			...(why === null ? {} : { unavailable: true, hint: why }),
		};
	};
	const items = $derived<readonly MenuItem[]>([
		...(disabled ? [] : actions),
		...(exports
			? [exportItem('png', R.exportPng, !disabled), exportItem('csv', R.exportCsv, false)]
			: []),
		{ id: 'shortcuts', label: R.shortcuts, separator: true },
	]);

	function choose(id: string): void {
		if (id === 'shortcuts') help?.showModal();
		else if (id === 'export-png') exports?.onexport('png');
		else if (id === 'export-csv') exports?.onexport('csv');
		else onaction(id);
	}
</script>

<Menu {items} label={R.menu} onselect={choose} bind:open>
	{#snippet trigger({ attrs, toggle })}
		<button
			bind:this={button}
			type="button"
			class="chip"
			data-narrow="fixed"
			{...attrs}
			aria-label={R.menu}
			title={R.menu}
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
	.chip:hover {
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

<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The row actions of the resource table as a menu button (phase-3.md 9.6, 7.1 W6 and W7;
	WCAG 2.5.7): Rename, Delete, Move up and down, Indent and Outdent for the selected person, for a
	pointer that cannot drag and for anyone who does not know the keys. Each item calls the same
	command as its key, so each is one text patch and one undo step. The button draws here; the list,
	its keys, its place and its bottom sheet on a finger are the shared Menu (ui/Menu.svelte). Without a
	selected person the button is disabled and says why.
-->
<script lang="ts" module>
	import type { MenuItem } from '../ui/Menu.svelte';
	export type MenuAction = MenuItem;
</script>

<script lang="ts">
	import { resourceStrings as R } from '../../lib/strings-resources';
	import Icon from '../Icon.svelte';
	import Menu from '../ui/Menu.svelte';

	interface Props {
		actions: readonly MenuAction[];
		disabled: boolean;
		onaction: (id: string) => void;
	}
	let { actions, disabled, onaction }: Props = $props();
</script>

<Menu
	items={actions}
	label={R.table.menu}
	onselect={onaction}
	align="end"
	sheet
	sheetTestid="resource-menu-sheet"
>
	{#snippet trigger({ attrs, toggle })}
		<button
			type="button"
			class="trigger"
			{...attrs}
			aria-label={R.table.menu}
			title={disabled ? R.table.menuOff : R.table.menu}
			{disabled}
			data-testid="resource-menu"
			onclick={toggle}
		>
			<Icon name="more" size={16} />
		</button>
	{/snippet}
</Menu>

<style>
	.trigger {
		display: inline-grid;
		place-items: center;
		inline-size: var(--size-control);
		block-size: var(--size-control);
		padding: 0;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-gantt-chip);
		color: var(--color-gantt-text);
		cursor: pointer;
	}
	.trigger:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.trigger:hover:not(:disabled) {
		background: var(--color-gantt-inset);
	}
	.trigger:focus-visible {
		outline: 3px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
</style>

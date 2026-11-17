<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The row actions of the resource table as a menu button (phase-3.md 9.6, 7.1 W6 and W7;
	WCAG 2.5.7): Rename, Delete, Move up and down, Indent and Outdent for the selected person, for a
	pointer that cannot drag and for anyone who does not know the keys. Each item calls the same
	command as its key, so each is one text patch and one undo step. Up and Down move through the
	items, Home and End go to the ends, Enter or Space chooses, Escape closes and gives the focus back
	to the button, and a click elsewhere closes it. Without a selected person the button is disabled
	and says why.
-->
<script lang="ts" module>
	export interface MenuAction {
		readonly id: string;
		readonly label: string;
		readonly disabled?: boolean;
		/** The key that does the same, as text, and for `aria-keyshortcuts`. */
		readonly show?: string;
		readonly aria?: string;
	}
</script>

<script lang="ts">
	import { resourceStrings as R } from '../../lib/strings-resources';
	import Icon from '../Icon.svelte';

	interface Props {
		actions: readonly MenuAction[];
		disabled: boolean;
		onaction: (id: string) => void;
	}
	let { actions, disabled, onaction }: Props = $props();

	const uid = $props.id();
	let open = $state(false);
	let button: HTMLButtonElement | undefined = $state();
	let list: HTMLUListElement | undefined = $state();

	const items = (): HTMLButtonElement[] =>
		list ? [...list.querySelectorAll<HTMLButtonElement>('button:not([disabled])')] : [];

	function show(): void {
		open = true;
		queueMicrotask(() => items()[0]?.focus());
	}
	function close(refocus: boolean): void {
		open = false;
		if (refocus) button?.focus();
	}
	function onkeydown(e: KeyboardEvent): void {
		const all = items();
		const at = all.indexOf(document.activeElement as HTMLButtonElement);
		let next: number | null = null;
		if (e.key === 'ArrowDown') next = (at + 1) % all.length;
		else if (e.key === 'ArrowUp') next = (at - 1 + all.length) % all.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = all.length - 1;
		else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			return close(true);
		} else if (e.key === 'Tab') return close(false);
		if (next === null) return;
		e.preventDefault();
		all[next]?.focus();
	}
	function onwindowdown(e: PointerEvent): void {
		if (open && e.target instanceof Node && !button?.parentElement?.contains(e.target))
			close(false);
	}
</script>

<svelte:window onpointerdown={onwindowdown} />

<div class="menu">
	<button
		bind:this={button}
		type="button"
		class="trigger"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls="{uid}-list"
		aria-label={R.table.menu}
		title={disabled ? R.table.menuOff : R.table.menu}
		{disabled}
		data-testid="resource-menu"
		onclick={() => (open ? close(false) : show())}
	>
		<Icon name="more" size={16} />
	</button>
	{#if open}
		<!-- A menu: the items are buttons in a list, moved through with the arrow keys. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<ul id="{uid}-list" role="menu" aria-label={R.table.menu} bind:this={list} {onkeydown}>
			{#each actions as a (a.id)}
				<li role="none">
					<button
						type="button"
						role="menuitem"
						disabled={a.disabled}
						data-action={a.id}
						aria-keyshortcuts={a.aria}
						onclick={() => {
							close(true);
							onaction(a.id);
						}}
						><span>{a.label}</span>{#if a.show}<kbd aria-hidden="true">{a.show}</kbd>{/if}</button
					>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.menu {
		position: relative;
		display: inline-flex;
	}
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
	.trigger:focus-visible,
	li button:focus-visible {
		outline: 3px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	ul {
		position: absolute;
		inset-block-start: calc(100% + 6px);
		inset-inline-end: 0;
		z-index: 30;
		display: grid;
		min-inline-size: 12rem;
		margin: 0;
		padding: var(--space-1);
		list-style: none;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}
	li button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		inline-size: 100%;
		min-block-size: var(--size-control);
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		text-align: start;
		cursor: pointer;
	}
	li button:hover:not(:disabled) {
		background: var(--color-row-hover);
	}
	li button:disabled {
		color: var(--color-text-muted);
		cursor: default;
	}
	kbd {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
</style>

<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Row actions (phase-2.md 7.1 R5, 10.2; WCAG 2.5.7): the commands of the selected task as buttons,
	for a pointer that cannot drag and for anyone who does not know the keys: move up and down,
	indent and outdent, rename, add after, delete. They call the same commands as the keys
	(interactions.svelte.ts), so each is one text patch and one undo step. A menu button opens a
	list of items: Up and Down move through them, Home and End go to the ends, Enter or Space
	chooses, Escape closes and gives the focus back to the button, and a click elsewhere closes it.
-->
<script lang="ts">
	import type { RowAction } from './types';
	import { SHORTCUTS } from '../../lib/gantt/keys';
	import { gestureStrings } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	interface Props {
		actions: readonly RowAction[];
		/** No task is selected: the button says so and does not open. */
		disabled: boolean;
		onaction: (id: string) => void;
	}
	let { actions, disabled, onaction }: Props = $props();

	const uid = $props.id();
	let open = $state(false);
	let button: HTMLButtonElement | undefined = $state();
	let list: HTMLUListElement | undefined = $state();
	let help: HTMLDialogElement | undefined = $state();

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
		class="chip"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls="{uid}-list"
		aria-label={gestureStrings.row.menu}
		title={gestureStrings.row.menu}
		{disabled}
		data-testid="row-menu"
		onclick={() => (open ? close(false) : show())}
	>
		<Icon name="more" size={16} />
	</button>
	{#if open}
		<!-- A menu: the items are buttons in a list, moved through with the arrow keys. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<ul
			id="{uid}-list"
			role="menu"
			aria-label={gestureStrings.row.menu}
			bind:this={list}
			{onkeydown}
		>
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
			<li role="none" class="sep">
				<button
					type="button"
					role="menuitem"
					data-action="shortcuts"
					onclick={() => {
						close(false);
						help?.showModal();
					}}><span>{gestureStrings.row.shortcuts}</span></button
				>
			</li>
		</ul>
	{/if}
</div>

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
	.menu {
		position: relative;
		display: inline-flex;
	}
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
	.chip:focus-visible,
	li button:focus-visible {
		outline: 3px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	ul {
		position: absolute;
		inset-block-start: calc(100% + 6px);
		inset-inline-start: 0;
		z-index: 30;
		display: grid;
		min-inline-size: 11rem;
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
		min-block-size: 32px;
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
	kbd {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.sep {
		margin-block-start: var(--space-1);
		padding-block-start: var(--space-1);
		border-block-start: 1px solid var(--color-border);
	}
	.help {
		inline-size: min(28rem, calc(100vw - 2 * var(--gutter)));
		padding: var(--space-5);
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
	li button:hover:not(:disabled) {
		background: var(--color-row-hover);
	}
	li button:disabled {
		color: var(--color-text-muted);
		cursor: default;
	}
	@media (pointer: coarse) {
		.chip {
			min-inline-size: var(--size-tap);
			min-block-size: var(--size-tap);
		}
		li button {
			min-block-size: var(--size-tap);
		}
	}
</style>

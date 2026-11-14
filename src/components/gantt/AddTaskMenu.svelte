<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Add task (+) control (phase-3.md 9.8; ADR-0013), first in the Gantt's toolbar on every
	layout. With no task selected (or in an empty plan) it is a plain button that adds at the end of
	the plan. With a task selected it opens a menu of two items, "Add task after" (focused first,
	the default) and "Add subtask". It only reports the choice: the Gantt sends the edit and opens
	the details. The menu keys are the row menu's: Up and Down, Home and End, Enter or Space,
	Escape closes and gives the focus back, a click elsewhere closes. A phone shows the plus alone
	(its name is the button's accessible name); the label shows where there is room for it.
-->
<script lang="ts">
	import type { AddMode } from '../../lib/gantt/add-task';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	interface Props {
		/** A task is selected: the button opens the choices instead of adding at once. */
		hasSelection: boolean;
		onadd: (mode: AddMode) => void;
		/** Which edge of the button the menu lines up with: `end` where the button is at the right. */
		align?: 'start' | 'end';
	}
	let { hasSelection, onadd, align = 'start' }: Props = $props();

	const S = strings.gantt.add;
	const uid = $props.id();
	let open = $state(false);
	let button: HTMLButtonElement | undefined = $state();
	let list: HTMLUListElement | undefined = $state();

	const items = (): HTMLButtonElement[] =>
		list ? [...list.querySelectorAll<HTMLButtonElement>('button:not([disabled])')] : [];

	function close(refocus: boolean): void {
		open = false;
		if (refocus) button?.focus();
	}
	function press(): void {
		if (!hasSelection) return onadd('after');
		if (open) return close(false);
		open = true;
		queueMicrotask(() => items()[0]?.focus());
	}
	function choose(mode: AddMode): void {
		close(true);
		onadd(mode);
	}
	// The selection went away while the menu was open: nothing to choose between.
	$effect(() => {
		if (!hasSelection) open = false;
	});
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

<div class="add">
	<button
		bind:this={button}
		type="button"
		class="chip primary"
		aria-label={S.label}
		aria-haspopup={hasSelection ? 'menu' : undefined}
		aria-expanded={hasSelection ? open : undefined}
		aria-controls={hasSelection ? `${uid}-list` : undefined}
		title={hasSelection ? S.hintMenu : S.hintEnd}
		data-testid="add-task"
		onclick={press}
	>
		<Icon name="plus" size={16} stroke={2.2} /><span class="lbl">{S.label}</span>
	</button>
	{#if open && hasSelection}
		<!-- A menu: the items are buttons in a list, moved through with the arrow keys. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<ul
			id="{uid}-list"
			role="menu"
			class:end={align === 'end'}
			aria-label={S.menu}
			bind:this={list}
			{onkeydown}
		>
			<li role="none">
				<button type="button" role="menuitem" data-action="after" onclick={() => choose('after')}
					>{S.after}</button
				>
			</li>
			<li role="none">
				<button
					type="button"
					role="menuitem"
					data-action="subtask"
					onclick={() => choose('subtask')}>{S.subtask}</button
				>
			</li>
		</ul>
	{/if}
</div>

<style>
	.add {
		position: relative;
		display: inline-flex;
	}
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
	ul.end {
		inset-inline-start: auto;
		inset-inline-end: 0;
	}
	li button {
		display: flex;
		align-items: center;
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
	li button:hover {
		background: var(--color-row-hover);
	}
	/* A phone has no room for the word: the plus is the button, 44 px wide. */
	@media (max-width: 599px) {
		.lbl {
			display: none;
		}
		.chip {
			padding-inline: 0;
		}
	}
	@media (pointer: coarse) {
		.chip {
			min-block-size: var(--size-tap);
			min-inline-size: var(--size-tap);
		}
		li button {
			min-block-size: var(--size-tap);
		}
	}
</style>

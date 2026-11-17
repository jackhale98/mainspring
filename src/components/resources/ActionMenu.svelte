<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The row actions of the resource table as a menu button (phase-3.md 9.6, 7.1 W6 and W7;
	WCAG 2.5.7): Rename, Delete, Move up and down, Indent and Outdent for the selected person, for a
	pointer that cannot drag and for anyone who does not know the keys. Each item calls the same
	command as its key, so each is one text patch and one undo step. Up and Down move through the
	items, Home and End go to the ends, Enter or Space chooses, Escape closes and gives the focus back
	to the button, and a click elsewhere closes it. Without a selected person the button is disabled
	and says why.

	On a finger (a coarse primary pointer) the same items open as a bottom sheet, the way the phone's
	other sheets do: they are as wide as the screen and 44 px high, do not wrap, show no key hints
	(there is no keyboard), and cannot be clipped by the view that holds the button. With a mouse the
	menu is a popover placed with `position: fixed` beside the button, flipped above it and scrolled
	when the room below is short, so that no view's edge cuts it either. A chosen action runs once
	the sheet has gone, when the page is no longer inert and the focus can move.
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
	import Sheet from '../Sheet.svelte';

	interface Props {
		actions: readonly MenuAction[];
		disabled: boolean;
		onaction: (id: string) => void;
	}
	let { actions, disabled, onaction }: Props = $props();

	const uid = $props.id();
	let open = $state(false);
	/** The menu is a bottom sheet (a finger), not a popover; follows the primary pointer. */
	const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
	let sheet = $state(coarse?.matches ?? false);
	$effect(() => {
		const on = (): void => {
			sheet = coarse?.matches ?? false;
		};
		coarse?.addEventListener('change', on);
		return () => coarse?.removeEventListener('change', on);
	});
	/** Where the popover goes: fixed to the viewport, beside the button, inside the room there is. */
	let place = $state('');
	/** The action chosen in the sheet, run when the sheet has gone (its `onleft`, in the task of the tap). */
	let chosen: string | null = null;
	let button: HTMLButtonElement | undefined = $state();
	let list: HTMLUListElement | undefined = $state();

	const items = (): HTMLButtonElement[] =>
		list ? [...list.querySelectorAll<HTMLButtonElement>('button:not([disabled])')] : [];

	function show(): void {
		sheet = coarse?.matches ?? false;
		if (!sheet && button) {
			const r = button.getBoundingClientRect();
			const below = innerHeight - r.bottom - 12;
			const above = r.top - 12;
			const up = below < 260 && above > below;
			place = [
				`right:${Math.max(8, innerWidth - r.right)}px`,
				up ? `bottom:${innerHeight - r.top + 6}px` : `top:${r.bottom + 6}px`,
				`max-block-size:${Math.max(120, up ? above : below)}px`,
			].join(';');
		}
		open = true;
		if (!sheet) queueMicrotask(() => items()[0]?.focus());
	}
	/**
	 * The sheet has gone: the chosen action runs now. It is `onleft`, in the timer task that ended the
	 * slide, not `onclose` (the dialog's `close` event, a task of its own without the tap): a Rename
	 * that focuses its field there still raises the touch keyboard on an iPhone.
	 */
	function sheetLeft(): void {
		const id = chosen;
		chosen = null;
		if (id !== null) onaction(id);
	}
	function close(refocus: boolean): void {
		open = false;
		if (refocus) button?.focus();
	}
	function onkeydown(e: KeyboardEvent): void {
		// In the sheet the dialog has Escape and the focus trap; the arrows, Home and End are ours.
		if (sheet && (e.key === 'Escape' || e.key === 'Tab')) return;
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
	/** A scroll that is not the menu's own (a view under it) takes the popover's place away. */
	function onscroll(e: Event): void {
		if (open && !sheet && !(e.target instanceof Node && list?.contains(e.target))) close(false);
	}
	/** The first item that can be chosen takes the focus when the sheet opens. */
	const firstId = $derived(actions.find((a) => !a.disabled)?.id);
	function onwindowdown(e: PointerEvent): void {
		if (open && !sheet && e.target instanceof Node && !button?.parentElement?.contains(e.target))
			close(false);
	}
</script>

<svelte:window
	onpointerdown={onwindowdown}
	onresize={() => !sheet && open && close(false)}
	onscrollcapture={onscroll}
/>

<div class="menu">
	<button
		bind:this={button}
		type="button"
		class="trigger"
		aria-haspopup={sheet ? 'dialog' : 'menu'}
		aria-expanded={open}
		aria-controls={open && !sheet ? `${uid}-list` : undefined}
		aria-label={R.table.menu}
		title={disabled ? R.table.menuOff : R.table.menu}
		{disabled}
		data-testid="resource-menu"
		onclick={() => (open ? close(false) : show())}
	>
		<Icon name="more" size={16} />
	</button>
	{#if open && !sheet}
		<!-- A menu: the items are buttons in a list, moved through with the arrow keys. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<ul
			id="{uid}-list"
			class="pop"
			role="menu"
			aria-label={R.table.menu}
			style={place}
			bind:this={list}
			{onkeydown}
		>
			{@render entries((id) => {
				close(true);
				onaction(id);
			})}
		</ul>
	{/if}
</div>
{#if sheet}
	<Sheet
		open={open && sheet}
		side="bottom"
		title={R.table.menu}
		onclose={() => (open = false)}
		onleft={sheetLeft}
	>
		<!-- A menu: the items are buttons in a list, moved through with the arrow keys. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<ul
			class="sheet-list"
			role="menu"
			aria-label={R.table.menu}
			data-testid="resource-menu-sheet"
			bind:this={list}
			{onkeydown}
		>
			{@render entries((id) => {
				chosen = id;
				open = false;
			})}
		</ul>
	</Sheet>
{/if}

{#snippet entries(choose: (id: string) => void)}
	{#each actions as a (a.id)}
		<li role="none">
			<!-- svelte-ignore a11y_autofocus -->
			<button
				type="button"
				role="menuitem"
				disabled={a.disabled}
				data-action={a.id}
				aria-keyshortcuts={a.aria}
				autofocus={sheet && a.id === firstId}
				onclick={() => choose(a.id)}
				><span>{a.label}</span>{#if a.show}<kbd aria-hidden="true">{a.show}</kbd>{/if}</button
			>
		</li>
	{/each}
{/snippet}

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
		display: grid;
		margin: 0;
		padding: var(--space-1);
		list-style: none;
	}
	.pop {
		position: fixed;
		z-index: 30;
		overflow-y: auto;
		min-inline-size: 12rem;
		max-inline-size: calc(100vw - 16px);
		margin: 0;
		padding: var(--space-1);
		list-style: none;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}
	/* The sheet's content brings its own padding and surface. */
	.sheet-list {
		padding: 0;
	}
	.sheet-list li button {
		min-block-size: var(--size-tap);
		font-size: var(--text-md);
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
		white-space: nowrap;
		cursor: pointer;
	}
	li button:hover:not(:disabled) {
		background: var(--color-row-hover);
	}
	li button:disabled {
		color: var(--color-text-muted);
		cursor: default;
	}
	/* A finger alone has no keyboard: the hints are noise there. With a mouse or a hardware keyboard
	   about (any fine pointer), the sheet shows them as the popover does. */
	@media not (any-pointer: fine) {
		.sheet-list kbd {
			display: none;
		}
	}
	kbd {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
</style>

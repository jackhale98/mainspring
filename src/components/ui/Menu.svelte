<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The one menu button's menu (ADR-0016 #3). Owner: ui-builder. Contract spec:
	tests/e2e/primitives/menu.spec.ts, on the dev page /dev/primitives. Consumers (their specs run on
	every change here): the row menu and the Add task control of the Gantt (gantt-add-task, gantt-
	structure, gantt-a11y, gantt-name-id, gantt-manipulation, gantt-people-picker, add-task-screenshots,
	phone-bugfixes, people-shell, new-plan) and the resource table's action menu (resources.spec).

	The owner draws the button (the `trigger` snippet gets the attributes the button needs and
	`toggle`) and lists the `items`; this holds everything else, so that the three menus that were
	copies of one another keep one set of rules:
	- Up and Down move through the items and wrap, Home and End go to the ends, Enter or Space chooses,
	  Escape closes and gives the focus back to the button, Tab closes, and a press anywhere outside
	  closes;
	- the list is `position: fixed`, placed by lib/ui/place.ts beside the button and pulled back inside
	  the viewport (360 px wide included), flipped above the button when the room is below is short, and
	  scrolled when neither side has room, so that no view's edge cuts it. A scroll that is not its
	  own, or a resize, closes it (it would no longer be beside its button);
	- with `sheet`, on a finger (a coarse primary pointer) the same items open as a bottom Sheet, as
	  wide as the screen with 44 px items. The chosen action runs once the sheet has gone, when the page
	  is no longer inert and the focus can move;
	- items are 44 px high on a finger; the key hints (`show`) are drawn only where a fine pointer is
	  about (a finger alone has no keyboard).

	An item that `unavailable` stays reachable (aria-disabled) and says why in its `hint`, which is
	its description; choosing it does nothing. A `disabled` item drops out of the arrow keys.
-->
<script lang="ts" module>
	export interface MenuItem {
		readonly id: string;
		readonly label: string;
		readonly disabled?: boolean;
		/** Reachable but not choosable; `hint` says why. */
		readonly unavailable?: boolean;
		readonly hint?: string;
		/** The key that does the same, as text, and for `aria-keyshortcuts`. */
		readonly show?: string;
		readonly aria?: string;
		/** A rule above this item. */
		readonly separator?: boolean;
	}
	/** What the owner's button needs. */
	export interface TriggerArgs {
		attrs: {
			'aria-haspopup': 'menu' | 'dialog';
			'aria-expanded': boolean;
			'aria-controls': string | undefined;
			'data-menu-trigger': true;
		};
		toggle: () => void;
		open: boolean;
	}
</script>

<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { placeBeside } from '../../lib/ui/place';
	import Sheet from '../Sheet.svelte';

	interface Props {
		items: readonly MenuItem[];
		/** The menu's accessible name (and the sheet's title). */
		label: string;
		onselect: (id: string) => void;
		open?: boolean;
		/** Which edge of the button the list lines up with. */
		align?: 'start' | 'end';
		/** On a finger the menu is a bottom sheet. */
		sheet?: boolean;
		/** The sheet's list, for tests. */
		sheetTestid?: string | undefined;
		trigger: Snippet<[TriggerArgs]>;
	}
	let {
		items,
		label,
		onselect,
		open = $bindable(false),
		align = 'start',
		sheet = false,
		sheetTestid,
		trigger,
	}: Props = $props();

	const uid = $props.id();
	const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
	/** Opens as a sheet: asked for, and a finger is the primary pointer. */
	let asSheet = $state(false);
	$effect(() => {
		if (!sheet) {
			asSheet = false;
			return;
		}
		const on = (): void => {
			asSheet = coarse?.matches ?? false;
		};
		on();
		coarse?.addEventListener('change', on);
		return () => coarse?.removeEventListener('change', on);
	});
	let host: HTMLSpanElement | undefined = $state();
	let list: HTMLUListElement | undefined = $state();
	/** The action chosen in the sheet, run when the sheet has gone (its `onleft`). */
	let chosen: string | null = null;

	const button = (): HTMLElement | null =>
		host?.querySelector<HTMLElement>('[data-menu-trigger]') ?? null;
	const buttons = (): HTMLButtonElement[] =>
		list ? [...list.querySelectorAll<HTMLButtonElement>('button:not([disabled])')] : [];
	/** The first item that can be chosen takes the focus when the sheet opens. */
	const firstId = $derived(items.find((i) => !i.disabled)?.id);

	function toggle(): void {
		if (open) return close(false);
		asSheet = sheet && (coarse?.matches ?? false);
		open = true;
	}
	function close(refocus: boolean): void {
		open = false;
		if (refocus) button()?.focus();
	}

	// Opened as a popover: place it, then focus the first item. The list is measured where the
	// browser has put it and moved before the next paint.
	$effect(() => {
		if (!open || asSheet || !list) return;
		const el = list;
		const anchor = button();
		if (!anchor) return;
		const r = anchor.getBoundingClientRect();
		const at = placeBeside(
			r,
			{ width: el.offsetWidth, height: el.scrollHeight + 2 },
			{ width: innerWidth, height: innerHeight },
			{ align },
		);
		el.style.left = `${at.left}px`;
		el.style.top = `${at.top}px`;
		el.style.maxBlockSize = `${Math.max(120, at.maxHeight)}px`;
		// The list is fixed and already placed on screen, so the focus must not scroll anything: a
		// page that is briefly taller than the view (a sheet that has just closed) would scroll, and
		// a scroll that is not the list's own closes the menu.
		placedBeside = { left: r.left, top: r.top };
		void tick().then(() => buttons()[0]?.focus({ preventScroll: true }));
	});

	function pick(item: MenuItem): void {
		if (item.disabled || item.unavailable) return;
		if (asSheet) {
			chosen = item.id;
			open = false;
			return;
		}
		close(true);
		onselect(item.id);
	}
	/**
	 * The sheet has gone: the chosen action runs now. It is `onleft`, in the timer task that ended the
	 * slide, not `onclose` (the dialog's `close` event, a task of its own without the tap): a Rename
	 * that focuses its field there still raises the touch keyboard on an iPhone.
	 */
	function sheetLeft(): void {
		const id = chosen;
		chosen = null;
		if (id !== null) onselect(id);
	}

	function onkeydown(e: KeyboardEvent): void {
		// In the sheet the dialog has Escape and the focus trap; the arrows, Home and End are ours.
		if (asSheet && (e.key === 'Escape' || e.key === 'Tab')) return;
		const all = buttons();
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
	/** Where the button was when the list was placed beside it. */
	let placedBeside: { left: number; top: number } | null = null;
	/**
	 * A scroll that is not the list's own (a view under it) takes the popover's place away, if it
	 * moved the button: a scroll somewhere else (a late scroll event from before the menu opened)
	 * leaves the list where it belongs.
	 */
	function onscroll(e: Event): void {
		if (!open || asSheet || (e.target instanceof Node && list?.contains(e.target))) return;
		const now = button()?.getBoundingClientRect();
		const was = placedBeside;
		if (!now || !was || Math.abs(now.left - was.left) > 1 || Math.abs(now.top - was.top) > 1) {
			close(false);
		}
	}
	function onwindowdown(e: PointerEvent): void {
		if (open && !asSheet && e.target instanceof Node && !host?.contains(e.target)) close(false);
	}

	const attrs = $derived({
		'aria-haspopup': asSheet ? ('dialog' as const) : ('menu' as const),
		'aria-expanded': open,
		'aria-controls': open && !asSheet ? `${uid}-list` : undefined,
		'data-menu-trigger': true as const,
	});
</script>

<svelte:window
	onpointerdown={onwindowdown}
	onresize={() => !asSheet && open && close(false)}
	onscrollcapture={onscroll}
/>

<span class="menu" bind:this={host}>
	{@render trigger({ attrs, toggle, open })}
	{#if open && !asSheet}
		<!-- A menu: the items are buttons in a list, moved through with the arrow keys. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<ul id="{uid}-list" class="pop" role="menu" aria-label={label} bind:this={list} {onkeydown}>
			{@render entries()}
		</ul>
	{/if}
</span>
{#if asSheet}
	<Sheet
		open={open && asSheet}
		side="bottom"
		title={label}
		onclose={() => (open = false)}
		onleft={sheetLeft}
	>
		<!-- A menu: the items are buttons in a list, moved through with the arrow keys. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<ul
			class="sheet-list"
			role="menu"
			aria-label={label}
			data-testid={sheetTestid}
			bind:this={list}
			{onkeydown}
		>
			{@render entries()}
		</ul>
	</Sheet>
{/if}

{#snippet entries()}
	{#each items as a (a.id)}
		<li role="none" class:sep={a.separator}>
			<!-- svelte-ignore a11y_autofocus -->
			<button
				type="button"
				role="menuitem"
				disabled={a.disabled}
				data-action={a.id}
				aria-keyshortcuts={a.aria}
				aria-disabled={a.unavailable ? 'true' : undefined}
				aria-describedby={a.unavailable && a.hint ? `${uid}-${a.id}-why` : undefined}
				class:unavailable={a.unavailable}
				autofocus={asSheet && a.id === firstId}
				onclick={() => pick(a)}
				><span>{a.label}</span>{#if a.show}<kbd aria-hidden="true">{a.show}</kbd
					>{/if}{#if a.hint && a.unavailable}<small id="{uid}-{a.id}-why">{a.hint}</small
					>{/if}</button
			>
		</li>
	{/each}
{/snippet}

<style>
	.menu {
		position: relative;
		display: inline-flex;
	}
	ul {
		display: grid;
		margin: 0;
		padding: var(--space-1);
		list-style: none;
	}
	.pop {
		position: fixed;
		inset: 0 auto auto 0;
		z-index: 30;
		overflow-y: auto;
		min-inline-size: 11rem;
		max-inline-size: calc(100vw - 16px);
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}
	/* The sheet's content brings its own padding and surface. */
	.sheet-list {
		padding: 0;
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
	.sheet-list li button {
		min-block-size: var(--size-tap);
		font-size: var(--text-md);
	}
	li button:hover:not(:disabled) {
		background: var(--color-row-hover);
	}
	li button:disabled {
		color: var(--color-text-muted);
		cursor: default;
	}
	li button:focus-visible {
		outline: 3px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	li button.unavailable {
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		color: var(--color-text-muted);
		white-space: normal;
		cursor: default;
	}
	li button small {
		font-size: var(--text-xs);
	}
	.sep {
		margin-block-start: var(--space-1);
		padding-block-start: var(--space-1);
		border-block-start: 1px solid var(--color-border);
	}
	kbd {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	@media (pointer: coarse) {
		li button {
			min-block-size: var(--size-tap);
		}
	}
	/* A finger alone has no keyboard: the hints are noise there. With a mouse or a hardware keyboard
	   about (any fine pointer) they show, in the popover and the sheet alike. */
	@media not (any-pointer: fine) {
		kbd {
			display: none;
		}
	}
</style>

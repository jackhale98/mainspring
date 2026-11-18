<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The one popover card (ADR-0016 #3). Owner: ui-builder. Contract spec:
	tests/e2e/primitives/popover.spec.ts, on the dev page /dev/primitives. Consumers (their specs run
	on every change here): the engine details in the status strip and the phone's plan status button
	(shell.spec, phone-status.spec, update-check.spec) and the Workload toolbar's thresholds
	(workload.spec).

	It is the native popover (`popover="auto"`, in the top layer: no view's edge can clip it, and the
	browser gives light dismiss, so a press outside closes it, and Escape). Opened by a button with
	`popovertarget={id}` (the declarative way, which also toggles it from the same button without
	light dismiss closing it first), or by setting `open`. What the native one does not do on its own,
	this does:
	- it stays inside the viewport. `placement="center"` is the browser's centring with a size that
	  never exceeds the screen; `placement="anchor"` places the card beside its button (lib/ui/place.ts:
	  inside the viewport at 360 px, flipped above when short) and `foot` pins it to the foot of the
	  screen above the tab bar on a phone, where a card beside a button would not fit;
	- Escape closes it and the focus returns to the button, in every browser: WebKit does not focus a
	  button that a tap pressed, so the browser's own return has nowhere to go;
	- Escape does not reach what is under it (the Gantt's own Escape).
	`open` follows the card (bind it for `aria-expanded`); `popover` is the element, for an owner that
	closes the card from a button inside it.
-->
<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { placeBeside } from '../../lib/ui/place';

	interface Props {
		id: string;
		/** A heading drawn in the card; without it, `label` names the card. */
		title?: string | undefined;
		/** The card's accessible name when it has no heading (it is then a group). */
		label?: string | undefined;
		testid?: string | undefined;
		placement?: 'center' | 'anchor';
		/** Anchored: which edge of the button the card lines up with. */
		align?: 'start' | 'end';
		/** Anchored: on a phone (under 600 px) the card is a panel at the foot of the screen. */
		foot?: boolean;
		/** The card's width (a CSS length); it never exceeds the screen. */
		width?: string;
		open?: boolean;
		popover?: HTMLElement | undefined;
		children: Snippet;
	}
	let {
		id,
		title,
		label,
		testid,
		placement = 'center',
		align = 'start',
		foot = false,
		width = '26rem',
		open = $bindable(false),
		popover = $bindable(),
		children,
	}: Props = $props();

	/** The focus was inside the card when it began to close (it goes back to the button). */
	let focusInside = false;
	/** Anchored: it has been placed, and is shown (before that it would be seen at the corner). */
	let placed = $state(false);

	const invoker = (): HTMLElement | null =>
		document.querySelector<HTMLElement>(`[popovertarget="${CSS.escape(id)}"]`);

	function place(): void {
		const el = popover;
		if (!el) return;
		el.style.removeProperty('left');
		el.style.removeProperty('top');
		el.style.removeProperty('max-block-size');
		if (placement === 'anchor') {
			const phone = foot && matchMedia('(max-width: 599px)').matches;
			const anchor = invoker();
			if (!phone && anchor) {
				const at = placeBeside(
					anchor.getBoundingClientRect(),
					{ width: el.offsetWidth, height: el.offsetHeight },
					{ width: innerWidth, height: innerHeight },
					{ align },
				);
				el.style.left = `${at.left}px`;
				el.style.top = `${at.top}px`;
				el.style.maxBlockSize = `${Math.max(120, at.maxHeight)}px`;
			}
		}
		placed = true;
	}

	function onbeforetoggle(e: ToggleEvent): void {
		if (e.newState === 'closed') focusInside = !!popover?.contains(document.activeElement);
	}
	function ontoggle(e: ToggleEvent): void {
		open = e.newState === 'open';
		if (open) place();
		else {
			placed = false;
			if (focusInside) invoker()?.focus();
			focusInside = false;
		}
	}

	// The owner opens or closes it through `open`.
	$effect(() => {
		const el = popover;
		const want = open;
		if (!el) return;
		if (want !== el.matches(':popover-open')) {
			if (want) el.showPopover();
			else el.hidePopover();
		}
	});
	// A resize moves the button: place it again.
	$effect(() => {
		if (!open || placement !== 'anchor') return;
		const on = (): void => void tick().then(place);
		addEventListener('resize', on);
		return () => removeEventListener('resize', on);
	});
</script>

<div
	{id}
	class="popover"
	popover="auto"
	data-testid={testid}
	data-placement={placement}
	data-foot={foot ? '' : undefined}
	data-placed={placed ? '' : undefined}
	role={label !== undefined ? 'group' : undefined}
	aria-label={label}
	style:--popover-width={width}
	bind:this={popover}
	{onbeforetoggle}
	{ontoggle}
	onkeydown={(e) => {
		if (e.key === 'Escape') e.stopPropagation();
	}}
>
	{#if title}<h2>{title}</h2>{/if}
	{@render children()}
</div>

<style>
	.popover {
		margin: auto;
		inline-size: min(var(--popover-width), calc(100vw - 2rem));
		max-block-size: min(80dvh, 44rem);
		overflow: auto;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-panel);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-raised);
	}
	/* Beside its button: placed by script, so it is not seen at the browser's centre first. */
	.popover[data-placement='anchor'] {
		inset: 0 auto auto 0;
		margin: 0;
		border-color: var(--color-border-strong);
		border-radius: var(--radius-md);
		opacity: 0;
	}
	.popover[data-placement='anchor'][data-placed] {
		opacity: 1;
	}
	/* A phone: the foot of the screen, above the tab bar. */
	@media (max-width: 599px) {
		.popover[data-foot] {
			inset: auto var(--space-2) var(--tabbar-clearance) var(--space-2);
			inline-size: auto;
		}
	}
	h2 {
		margin: 0 0 var(--space-2);
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 400;
	}
</style>

<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The one <select> of the app (ADR-0016 #3). Owner: ui-builder. Contract spec:
	tests/e2e/primitives/select.spec.ts, on the dev page /dev/primitives. Consumers (their specs run
	on every change here): the task details (inspector.spec, inspector-depends.spec), the new-plan
	sheet, the Gantt toolbar, the Workload and Calendar bars, the view switcher, the calendar's
	day details and leave cards, a heat cell's move menus, the health fixes, the file switcher, the
	top bar's plan chip; select-arrows.spec.ts checks all of them for their arrow.

	It is a native <select> (the best picker on a phone, fully accessible) that draws its own arrow:
	WebKit paints its grey fill and a white arrow whatever `background` says, so `appearance: none`
	turns that off and the arrow is a separate element, which a component's `background` or `padding`
	shorthand cannot reach (a global background-image rule lost to those in seven selects). Its own CSS
	holds everything a variant draws, so nothing but its `class` hook and `:global(select)` reaches it.
	On a coarse pointer the text is at least 16 px, because iOS zooms the page into a smaller field
	(the viewport stays zoomable: WCAG 1.4.4). In forced colors the browser draws the select, arrow
	included.

	Variants:
	- `field` (default): a full-width field in the inputs' look; `size="sm"` is the small text of the
	  calendar's cards;
	- `pill`: a pill that stands alone (the health fixes, a heat cell's move menus);
	- `inline`: no border or fill, to sit inside a chip that its owner draws (`position: relative`; the
	  owner leaves room at the end for the arrow, `--select-caret-end` moves it); the arrow is drawn
	  by this component, in the chip;
	- `overlay`: the native control, invisible, over its parent (`position: relative`): the parent
	  draws the glyph and a tap anywhere opens the native list (the plan chip, replace person).

	`options` gives the choices; for optgroups or the like pass the options as children instead.
	`onchange(value, el)` runs when the person chooses; a returned `false` (or a promise of it) puts
	the plan's `value` back, so that a refused edit does not leave the choice on screen.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLSelectAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLSelectAttributes, 'value' | 'onchange' | 'children' | 'size'> {
		value: string;
		options?: readonly { value: string; label: string; disabled?: boolean }[] | undefined;
		onchange?: ((value: string, el: HTMLSelectElement) => unknown) | undefined;
		variant?: 'field' | 'pill' | 'inline' | 'overlay';
		size?: 'md' | 'sm';
		/** The select element, for an owner that moves its focus. */
		el?: HTMLSelectElement | undefined;
		children?: Snippet | undefined;
	}
	let {
		value,
		options,
		onchange,
		variant = 'field',
		size = 'md',
		el = $bindable(),
		class: klass,
		children,
		...rest
	}: Props = $props();

	async function change(e: Event & { currentTarget: HTMLSelectElement }): Promise<void> {
		const select = e.currentTarget;
		const applied = await onchange?.(select.value, select);
		if (applied === false) select.value = value;
	}
</script>

<span class="select {klass ?? ''}" data-select data-variant={variant} data-size={size}>
	<select bind:this={el} {...rest} {value} onchange={change}>
		{#if options}
			{#each options as o (o.value)}
				<option value={o.value} disabled={o.disabled} selected={o.value === value}>{o.label}</option
				>
			{/each}
		{:else}
			{@render children?.()}
		{/if}
	</select>
	{#if variant !== 'overlay'}<span class="caret" aria-hidden="true"></span>{/if}
</span>

<style>
	.select {
		position: relative;
		min-inline-size: 0;
	}
	select {
		appearance: none;
		-webkit-appearance: none;
		box-sizing: border-box;
		margin: 0;
		color: var(--color-text);
		font: inherit;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	select:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.caret {
		position: absolute;
		inset-block-start: 50%;
		inset-inline-end: var(--select-caret-end, 0.95rem);
		inline-size: 0.4rem;
		block-size: 0.4rem;
		border: solid currentColor;
		border-width: 0 2px 2px 0;
		color: var(--color-text);
		transform: translateY(-65%) rotate(45deg);
		pointer-events: none;
	}
	/* A full-width field. */
	.select[data-variant='field'] {
		inline-size: 100%;
	}
	:where([data-variant='field']) select {
		inline-size: 100%;
		min-block-size: var(--size-control);
		padding-block: 0;
		padding-inline: var(--space-3) 2rem;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background-color: var(--color-surface);
		font-size: var(--text-md);
	}
	:where([data-variant='field'][data-size='sm']) select {
		padding-inline-start: var(--space-2);
		font-size: var(--text-sm);
	}
	:where([data-variant='field']) select[aria-invalid='true'] {
		border-color: var(--color-ruby);
	}
	:where([data-variant='field']) select:disabled {
		background-color: var(--color-surface-sunken);
		color: var(--color-text-muted);
	}
	/* A pill on its own. */
	.select[data-variant='pill'] {
		display: inline-block;
	}
	:where([data-variant='pill']) select {
		max-inline-size: 12rem;
		min-block-size: 32px;
		padding-block: 0;
		padding-inline: var(--space-3) 1.9rem;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background-color: var(--color-surface);
		font-size: var(--text-xs);
	}
	:where([data-variant='pill']) select:hover:not(:disabled) {
		background-color: var(--color-row-hover);
	}
	:where([data-variant='pill']) .caret {
		--select-caret-end: 0.8rem;
		inline-size: 0.35rem;
		block-size: 0.35rem;
	}
	/* Inside a chip of the owner's: the chip is the box, this is its text and arrow. The wrapper
	   takes no box, so that the select is a child of the chip's flex row. */
	.select[data-variant='inline'] {
		display: contents;
	}
	:where([data-variant='inline']) select {
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
	}
	[data-variant='inline'] select:focus-visible {
		outline: none;
	}
	:where([data-variant='inline']) .caret {
		inset-inline-end: var(--select-caret-end, 10px);
		color: var(--color-gantt-text-muted);
	}
	/* The native control, invisible, over its parent. */
	.select[data-variant='overlay'] {
		display: contents;
	}
	:where([data-variant='overlay']) select {
		position: absolute;
		inset: 0;
		inline-size: 100%;
		block-size: 100%;
		border: 0;
		border-radius: inherit;
		background: transparent;
		opacity: 0;
	}
	select:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	[data-variant='pill'] select:focus-visible {
		outline-width: 3px;
		outline-offset: 2px;
	}
	/* iOS zooms into a field under 16 px; every variant is at least that on a finger. */
	@media (pointer: coarse) {
		select {
			font-size: max(16px, 1rem);
		}
		:where([data-variant='pill']) select {
			min-block-size: var(--size-tap);
		}
	}
	@media (forced-colors: active) {
		select {
			appearance: auto;
			-webkit-appearance: auto;
			padding-inline-end: revert;
		}
		.caret {
			display: none;
		}
	}
</style>

<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A modal sheet on the native <dialog>: the browser traps focus, makes the page behind inert and
	closes on Escape, and returns focus to what opened it. It slides in from the start edge (the
	outline drawer on tablets) or the bottom (the docs sheet). Clicking the backdrop closes it.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { strings } from '../lib/strings';
	import Icon from './Icon.svelte';

	interface Props {
		open: boolean;
		side: 'start' | 'bottom';
		title: string;
		closeLabel?: string;
		onclose: () => void;
		children: Snippet;
	}
	let { open, side, title, closeLabel = strings.editor.close, onclose, children }: Props = $props();

	let dialog: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	function backdropClick(event: MouseEvent): void {
		if (event.target === dialog) dialog?.close();
	}
</script>

<!-- Escape is handled by the dialog itself; a click on the backdrop is a pointer shortcut. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialog}
	class="sheet"
	data-side={side}
	aria-labelledby="sheet-title-{side}"
	{onclose}
	onclick={backdropClick}
>
	{#if open}
		<div class="inner">
			<header>
				<h2 id="sheet-title-{side}">{title}</h2>
				<button type="button" class="close" onclick={() => dialog?.close()}>
					<Icon name="close" size={15} />{closeLabel}
				</button>
			</header>
			<!--
				The bottom sheet holds plain text that can scroll. Safari does not make a scrolling
				element keyboard-reachable on its own (axe scrollable-region-focusable), so it is a
				named, focusable region. The drawer's content is an interactive tree and needs no stop.
			-->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="content"
				role={side === 'bottom' ? 'region' : undefined}
				aria-labelledby={side === 'bottom' ? `sheet-title-${side}` : undefined}
				tabindex={side === 'bottom' ? 0 : undefined}
			>
				{@render children()}
			</div>
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		padding: 0;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-raised);
		max-inline-size: none;
		max-block-size: none;
	}
	.sheet::backdrop {
		background: var(--color-overlay);
	}
	/* The drawer floats like a panel: inset from the edges, rounded on the open side. */
	.sheet[data-side='start'] {
		inset: var(--gap-panel) auto var(--gap-panel) var(--gap-panel);
		inline-size: min(22rem, 90vw);
		block-size: calc(100dvh - 2 * var(--gap-panel));
		border: 0;
		border-radius: var(--radius-panel);
		animation: slide-start var(--motion-base) ease-out;
	}
	/* Pinned to the bottom the way the browser centres a dialog: inset 0, fit-content height, and
	   an auto top margin. With top: auto instead, Safari on iPhone placed the sheet off screen and
	   only the backdrop showed. */
	.sheet[data-side='bottom'] {
		inset: 0;
		margin: auto auto 0;
		inline-size: min(40rem, 100vw);
		block-size: fit-content;
		max-block-size: 80dvh;
		border-block-end: 0;
		border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
		animation: slide-bottom var(--motion-base) ease-out;
	}
	.inner {
		display: flex;
		flex-direction: column;
		max-block-size: inherit;
		block-size: 100%;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-4);
		border-block-end: 1px solid var(--color-border);
	}
	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 400;
	}
	.close {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-block-size: var(--size-tap);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	.close:hover {
		background: var(--color-row-hover);
	}
	.content {
		flex: 1;
		min-block-size: 0;
		overflow: auto;
		overscroll-behavior: contain;
		padding: var(--space-3) var(--space-4) var(--space-6);
	}
	.content:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}
	.sheet[data-side='start'] .content {
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	@keyframes slide-start {
		from {
			transform: translateX(-100%);
		}
	}
	@keyframes slide-bottom {
		from {
			transform: translateY(100%);
		}
	}
</style>

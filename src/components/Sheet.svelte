<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A modal sheet on the native <dialog>: the browser traps focus, makes the page behind inert and
	closes on Escape, and returns focus to what opened it. It slides in from the start edge (the
	outline drawer on tablets) or the bottom (the docs sheet). Clicking the backdrop closes it.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { strings } from '../lib/strings';

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
				<button type="button" class="close" onclick={() => dialog?.close()}>{closeLabel}</button>
			</header>
			<div class="content">
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
	.sheet[data-side='start'] {
		inset: 0 auto 0 0;
		inline-size: min(22rem, 90vw);
		block-size: 100dvh;
		border-block: 0;
		border-inline-start: 0;
		animation: slide-start var(--motion-base) ease-out;
	}
	.sheet[data-side='bottom'] {
		inset: auto 0 0 0;
		margin-inline: auto;
		inline-size: min(40rem, 100vw);
		max-block-size: 80dvh;
		border-block-end: 0;
		border-radius: var(--radius-md) var(--radius-md) 0 0;
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
		font-size: var(--text-md);
	}
	.close {
		min-block-size: var(--size-tap);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	.content {
		flex: 1;
		min-block-size: 0;
		overflow: auto;
		padding: var(--space-3) var(--space-4) var(--space-6);
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

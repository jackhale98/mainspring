<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The card the engine details and the phone's plan status open in: a native popover (light
	dismiss, Escape, focus back on the button that opened it), centred in the window and never
	taller than the screen, so it is fully on screen on a phone. The browser centres a popover
	(fixed, inset 0, auto margins); the size is set here. Desktop's EngineInfo and the phone's
	StatusButton share it, and the sections inside (EngineDetails) are the same.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		id: string;
		title: string;
		testid?: string;
		/** The popover element, so that its owner can close it (a button inside that navigates). */
		popover?: HTMLElement | undefined;
		children: Snippet;
	}
	let { id, title, testid, popover = $bindable(), children }: Props = $props();
</script>

<div {id} class="popover" popover="auto" data-testid={testid} bind:this={popover}>
	<h2>{title}</h2>
	{@render children()}
</div>

<style>
	.popover {
		margin: auto;
		inline-size: min(26rem, calc(100vw - 2rem));
		max-block-size: min(80dvh, 44rem);
		overflow: auto;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-panel);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-raised);
	}
	h2 {
		margin: 0 0 var(--space-2);
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 400;
	}
</style>

<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The toolbar row of a People view on a desktop and a tablet (phase-3.md 9.1): the same band as the
	Gantt's toolbar (surface, rule, padding), with the view switcher first. T14 to T17 add their own
	chips after it. It is the container the switcher narrows with (ViewSwitcher.svelte).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}
	let { children }: Props = $props();
</script>

<div class="bar" data-testid="view-bar">{@render children()}</div>

<style>
	.bar {
		flex: none;
		container-type: inline-size;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-inline-size: 0;
		padding: 7px 14px;
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface);
	}
</style>

<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Health button of the top bar on a desktop and a tablet (phase-3.md 9.1): an icon with the
	number of findings. It opens the right panel's Health tab on a desktop and a bottom sheet on a
	tablet (a phone has the status button's card instead). The count is in the button's name, so a
	screen reader hears "Plan health: 12 problems" (10). Before the first report there is no number
	and the name is just "Plan health". Only this button, the state and the tabs are in a first
	load: the panel, the checks and the explainer are chunks that load when they are first needed.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	let { app }: { app: AppState } = $props();

	const health = $derived(app.health);
	const count = $derived(health.count);
	const name = $derived(strings.health.button(count));
	/** "999+" keeps the badge from growing past the button on a plan with hundreds of findings. */
	const badge = $derived(count === null ? '' : count > 999 ? '999+' : String(count));
</script>

<button
	type="button"
	class="health-button"
	class:open={health.open}
	aria-label={name}
	aria-expanded={health.open}
	aria-haspopup="dialog"
	title={name}
	data-testid="health-button"
	data-count={count ?? ''}
	onclick={() => health.toggle()}
>
	<Icon name="pulse" size={17} />
	{#if count !== null}
		<span class="count" class:zero={count === 0} aria-hidden="true" data-testid="health-count"
			>{badge}</span
		>
	{/if}
</button>

<style>
	.health-button {
		position: relative;
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-inline-size: var(--size-control);
		block-size: var(--size-control);
		padding-inline: 8px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
		color: var(--color-text);
		cursor: pointer;
	}
	.health-button:hover {
		background: var(--color-row-hover);
	}
	.health-button.open {
		border-color: var(--color-accent);
	}
	.health-button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.count {
		font-size: var(--text-xs);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.count.zero {
		color: var(--color-text-muted);
	}
</style>

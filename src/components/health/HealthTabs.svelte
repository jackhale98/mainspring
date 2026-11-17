<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The right panel's two tabs, Details and Health (phase-3.md 9.2). A tab list with the arrow keys
	(Left, Right, Home, End move and select), as the ARIA pattern says; the panel under it is the
	owner's. Health's tab shows the number of findings as a badge, hidden from assistive
	technology: the Health button's name and the panel's summary say it in words.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';

	interface Props {
		app: AppState;
		/** The id of the tab panel the selected tab controls. */
		panel: string;
	}
	let { app, panel }: Props = $props();

	const H = strings.health;
	const health = $derived(app.health);
	let list: HTMLElement | undefined = $state();

	async function choose(health_: boolean, focus: boolean): Promise<void> {
		if (health_) health.show();
		else health.hide();
		if (!focus) return;
		await tick();
		list?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
	}

	function onkeydown(e: KeyboardEvent): void {
		const to =
			e.key === 'ArrowRight' || e.key === 'ArrowLeft'
				? !health.open
				: e.key === 'Home'
					? false
					: e.key === 'End'
						? true
						: null;
		if (to === null || e.ctrlKey || e.metaKey || e.altKey) return;
		e.preventDefault();
		void choose(to, true);
	}
</script>

<!-- The tab list's keys are its own; the tabs are the interactive elements. -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tabs" role="tablist" aria-label={H.tabs} bind:this={list} {onkeydown}>
	<button
		type="button"
		role="tab"
		id="{panel}-tab-details"
		aria-selected={!health.open}
		aria-controls={panel}
		tabindex={health.open ? -1 : 0}
		data-testid="tab-details"
		onclick={() => choose(false, false)}>{H.detailsTab}</button
	>
	<button
		type="button"
		role="tab"
		id="{panel}-tab-health"
		aria-selected={health.open}
		aria-controls={panel}
		tabindex={health.open ? 0 : -1}
		data-testid="tab-health"
		onclick={() => choose(true, false)}
	>
		{H.tab}{#if health.count !== null}<span class="count" aria-hidden="true">{health.count}</span
			>{/if}
	</button>
</div>

<style>
	.tabs {
		display: flex;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-3) 0;
		border-block-end: 1px solid var(--color-border);
	}
	[role='tab'] {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: var(--size-control);
		padding-inline: var(--space-3);
		border: 0;
		border-block-end: 3px solid transparent;
		background: transparent;
		color: var(--color-text-muted);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	[role='tab'][aria-selected='true'] {
		border-block-end-color: var(--color-accent);
		color: var(--color-text);
		font-weight: 600;
	}
	[role='tab']:hover {
		color: var(--color-text);
	}
	[role='tab']:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
		border-radius: var(--radius-md);
	}
	.count {
		min-inline-size: 1.6em;
		padding: 0 6px;
		border-radius: var(--radius-pill);
		background: var(--color-badge-bg);
		color: var(--color-badge-text);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
</style>

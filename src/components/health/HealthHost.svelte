<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The door to the health panel's chunk (phase-3.md 8.3): the panel, its checks and its fixes are
	imported when the panel is first shown, and the component is then kept for later mounts. It
	holds the loading and failure states, so the panel itself can assume it is there. A chunk that
	cannot be fetched (offline with nothing cached, a deploy that replaced it) says so with "Try
	again"; a second failure in a row offers a reload, asking first when the plan was edited, since
	a browser may remember a failed import (the People views do the same).
-->
<script lang="ts" module>
	import type { Component } from 'svelte';
	import type { AppState } from '../../lib/state/app.svelte';

	type Panel = Component<{ app: AppState; sheet: boolean }>;
	/** The chunk's component once loaded: a later mount shows it at once. */
	let loaded: Panel | null = null;
</script>

<script lang="ts">
	import { strings } from '../../lib/strings';

	let { app, sheet = false }: { app: AppState; sheet?: boolean } = $props();

	const H = strings.health;
	let Chunk = $state.raw<Panel | null>(loaded);
	let failures = $state(0);
	let failed = $state(false);
	let attempt = $state(0);

	$effect(() => {
		void attempt;
		if (Chunk !== null) return;
		failed = false;
		import('./HealthPanel.svelte').then(
			(m) => {
				loaded = Chunk = m.default as Panel;
				failures = 0;
			},
			() => {
				failures++;
				failed = true;
			},
		);
	});

	function retry(): void {
		if (failures >= 2) {
			// What autosave holds is stored first; it asks only if changes would be lost.
			void app.reloadPage();
			return;
		}
		attempt++;
	}
</script>

{#if Chunk}
	<Chunk {app} {sheet} />
{:else if failed}
	<div class="state" role="alert" data-testid="health-failed">
		<p>{H.loadFailed}</p>
		<button type="button" onclick={retry}>
			{failures >= 2 ? strings.people.reload : H.retry}
		</button>
	</div>
{:else}
	<p class="state muted" role="status">{H.loading}</p>
{/if}

<style>
	.state {
		display: grid;
		justify-items: start;
		gap: var(--space-2);
		margin: 0;
		font-size: var(--text-sm);
	}
	.muted {
		color: var(--color-text-muted);
	}
	button {
		min-block-size: var(--size-control);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	button:hover {
		background: var(--color-row-hover);
	}
	button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>

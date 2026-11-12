<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The phone's bottom tab bar (phase-1.md 8.1, 14.7): Plan and Text only. Gantt and People join
	it in Phases 2 and 3. A tablist with arrow keys, selecting a tab shows its panel.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { AppState, PhoneTab } from '../lib/state/app.svelte';
	import { strings } from '../lib/strings';

	let { app }: { app: AppState } = $props();

	const TABS: ReadonlyArray<{ id: PhoneTab; label: string }> = [
		{ id: 'plan', label: strings.panels.plan },
		{ id: 'text', label: strings.panels.text },
	];

	async function onkeydown(event: KeyboardEvent): Promise<void> {
		const at = TABS.findIndex((t) => t.id === app.phoneTab);
		let next = at;
		if (event.key === 'ArrowRight') next = (at + 1) % TABS.length;
		else if (event.key === 'ArrowLeft') next = (at - 1 + TABS.length) % TABS.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = TABS.length - 1;
		else return;
		event.preventDefault();
		const tab = TABS[next];
		if (!tab) return;
		app.phoneTab = tab.id;
		await tick();
		document.getElementById(`tab-${tab.id}`)?.focus();
	}
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tabbar" role="tablist" aria-label={strings.panels.tabs} {onkeydown}>
	{#each TABS as tab (tab.id)}
		<button
			type="button"
			role="tab"
			id="tab-{tab.id}"
			aria-selected={app.phoneTab === tab.id}
			aria-controls="panel-{tab.id}"
			tabindex={app.phoneTab === tab.id ? 0 : -1}
			onclick={() => (app.phoneTab = tab.id)}
		>
			{tab.label}
		</button>
	{/each}
</div>

<style>
	.tabbar {
		display: grid;
		grid-template-columns: 1fr 1fr;
		min-block-size: var(--size-tabbar);
		border-block-start: 1px solid var(--color-border);
		background: var(--color-surface);
		padding-block-end: env(safe-area-inset-bottom);
	}
	button {
		border: 0;
		border-block-start: 3px solid transparent;
		background: transparent;
		color: var(--color-text-muted);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	button[aria-selected='true'] {
		border-block-start-color: var(--color-accent);
		color: var(--color-accent);
		background: var(--color-surface-sunken);
	}
</style>

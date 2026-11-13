<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The phone's floating pill tab bar (phase-1.md 8.1, 14.7; phase-2.md 9.2; ADR-0009): Plan, Gantt
	and Text, inset from the edges and above the home indicator. People joins in Phase 3. A tablist
	with arrow keys; selecting a tab shows its panel. The active tab is a brass wash with a brass
	ink label (steel is not used here); the icons are decorative.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { IconName } from '../../lib/icons';
	import type { AppState, PhoneTab } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	interface Props {
		app: AppState;
		/** Called with the tab the user chose (not when the app moves to a tab itself). */
		onchange?: (tab: PhoneTab) => void;
	}
	let { app, onchange }: Props = $props();

	function choose(tab: PhoneTab): void {
		app.phoneTab = tab;
		onchange?.(tab);
	}

	const TABS: ReadonlyArray<{ id: PhoneTab; label: string; icon: IconName }> = [
		{ id: 'plan', label: strings.panels.plan, icon: 'list' },
		{ id: 'gantt', label: strings.panels.gantt, icon: 'visual' },
		{ id: 'text', label: strings.panels.text, icon: 'code' },
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
		choose(tab.id);
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
			onclick={() => choose(tab.id)}
		>
			<Icon name={tab.icon} size={20} />
			<span>{tab.label}</span>
		</button>
	{/each}
</div>

<style>
	/* Above the details sheet, so that the tabs stay reachable while it is open. */
	.tabbar {
		position: relative;
		z-index: 25;
		display: flex;
		gap: 4px;
		block-size: var(--size-tabbar);
		margin: 6px 14px calc(12px + env(safe-area-inset-bottom));
		padding: 6px;
		border: 1px solid var(--color-border-strong);
		border-radius: 22px;
		background: var(--color-surface-raised);
		box-shadow: var(--shadow-dock);
	}
	button {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		min-inline-size: 0;
		border: 0;
		border-radius: 16px;
		background: transparent;
		color: var(--color-text-muted);
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color var(--motion-fast);
	}
	button[aria-selected='true'] {
		background: var(--color-brass-wash);
		color: var(--color-brass-ink);
		font-weight: 700;
	}
</style>

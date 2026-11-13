<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The top bar (phase-1.md 8.1): the app name, the outline button where the outline is a drawer, the sample picker,
	the view switch (Text, Split, Visual; a phone has its tab bar instead) and the engine's state.
	On phones the engine state shrinks to a dot with the words kept for screen readers.
-->
<script lang="ts">
	import type { AppState } from '../lib/state/app.svelte';
	import type { LayoutKind } from '../lib/state/layout.svelte';
	import type { ViewMode } from '../lib/state/view-mode';
	import { engineLine, strings } from '../lib/strings';
	import ViewSwitch from './gantt/ViewSwitch.svelte';

	interface Props {
		app: AppState;
		layout: LayoutKind;
		mode: ViewMode;
		/** Whether the outline is a drawer here, so that the top bar has the button for it. */
		drawer: boolean;
		onmode: (mode: ViewMode) => void;
	}
	let { app, layout, mode, drawer, onmode }: Props = $props();

	async function pick(event: Event & { currentTarget: HTMLSelectElement }): Promise<void> {
		const select = event.currentTarget;
		const opened = await app.openSample(select.value);
		// A cancelled switch leaves the old plan open: show it in the picker again.
		if (!opened) select.value = app.sampleId;
	}
</script>

<header class="topbar">
	{#if drawer}
		<button
			type="button"
			class="outline-button"
			aria-haspopup="dialog"
			aria-expanded={app.outlineOpen}
			onclick={() => (app.outlineOpen = true)}
		>
			{strings.panels.outlineOpen}
		</button>
	{/if}
	<h1 class="brand"><span class="mark" aria-hidden="true"></span>{strings.appName}</h1>
	<label class="picker">
		<span class="sr-only">{strings.topBar.sample}</span>
		<select value={app.sampleId} onchange={pick}>
			{#each app.samples as sample (sample.id)}
				<option value={sample.id}>{sample.label}</option>
			{/each}
		</select>
	</label>
	{#if layout !== 'phone'}
		<ViewSwitch {mode} {onmode} />
	{/if}
	<p class="engine" data-testid="engine-status" data-state={app.engine}>
		<span class:sr-only={layout === 'phone'}>{engineLine(app.engine)}</span>
	</p>
</header>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-block-size: var(--size-topbar);
		padding: var(--space-2) var(--gutter);
		background: var(--color-surface);
		border-block-end: 1px solid var(--color-border);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		font-size: var(--text-md);
		font-weight: 700;
	}
	.mark {
		inline-size: 1.25rem;
		block-size: 1.25rem;
		border-radius: 50%;
		border: 3px solid var(--color-accent);
	}
	.picker select {
		min-block-size: 2.25rem;
		max-inline-size: 100%;
		padding-inline: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
	}
	.engine {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 0 auto;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.engine::before {
		content: '';
		flex: none;
		inline-size: 0.625rem;
		block-size: 0.625rem;
		border-radius: 50%;
		background: var(--color-status-neutral);
	}
	.engine[data-state='idle']::before {
		background: var(--color-status-ok);
	}
	.engine[data-state='busy']::before,
	.engine[data-state='booting']::before {
		background: var(--color-accent);
	}
	.engine[data-state='failed']::before {
		background: var(--color-diagnostic-error);
	}
	.outline-button {
		min-block-size: 2.25rem;
		padding-inline: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	@media (pointer: coarse) {
		.outline-button,
		.picker select {
			min-block-size: var(--size-tap);
		}
	}
	@media (max-width: 599px) {
		.topbar {
			gap: var(--space-2);
		}
		.picker {
			min-inline-size: 0;
			flex: 1 1 auto;
		}
		.picker select {
			inline-size: 100%;
			font-size: max(16px, var(--text-sm));
		}
	}
</style>

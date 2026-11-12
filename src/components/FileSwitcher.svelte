<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Switches the open file: tabs on tablets and desktops (a tablist with arrow keys), a select on
	phones, where tabs would not fit and a tab bar already sits at the bottom (phase-1.md 8.1).
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { AppState } from '../lib/state/app.svelte';
	import type { LayoutKind } from '../lib/state/layout.svelte';
	import { strings } from '../lib/strings';

	interface Props {
		app: AppState;
		layout: LayoutKind;
	}
	let { app, layout }: Props = $props();

	let list: HTMLDivElement | undefined = $state();

	async function onkeydown(event: KeyboardEvent): Promise<void> {
		const files = app.files;
		const at = files.indexOf(app.activeFile);
		let next = at;
		if (event.key === 'ArrowRight') next = (at + 1) % files.length;
		else if (event.key === 'ArrowLeft') next = (at - 1 + files.length) % files.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = files.length - 1;
		else return;
		event.preventDefault();
		const path = files[next];
		if (path === undefined) return;
		app.openFile(path);
		await tick();
		list?.querySelector<HTMLElement>(`#file-tab-${next}`)?.focus();
	}
</script>

{#if layout === 'phone'}
	<label class="select">
		<span class="sr-only">{strings.editor.file}</span>
		<select
			value={app.activeFile}
			onchange={(e) => app.openFile(e.currentTarget.value)}
			disabled={app.files.length < 2}
		>
			{#each app.files as path (path)}
				<option value={path}>{path}</option>
			{/each}
		</select>
	</label>
{:else}
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div class="tabs" role="tablist" aria-label={strings.editor.files} bind:this={list} {onkeydown}>
		{#each app.files as path, i (path)}
			<button
				type="button"
				role="tab"
				id="file-tab-{i}"
				aria-selected={path === app.activeFile}
				aria-controls="panel-editor"
				tabindex={path === app.activeFile ? 0 : -1}
				title={path}
				onclick={() => app.openFile(path)}
			>
				{path}
			</button>
		{/each}
	</div>
{/if}

<style>
	.tabs {
		display: flex;
		min-inline-size: 0;
		overflow-x: auto;
	}
	[role='tab'] {
		min-block-size: 2.5rem;
		padding-inline: var(--space-4);
		border: 0;
		border-block-end: 3px solid transparent;
		background: transparent;
		color: var(--color-text-muted);
		font: inherit;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		white-space: nowrap;
		cursor: pointer;
	}
	[role='tab'][aria-selected='true'] {
		border-block-end-color: var(--color-accent);
		color: var(--color-text);
		font-weight: 600;
	}
	[role='tab']:hover {
		background: var(--color-row-hover);
	}
	.select select {
		min-block-size: var(--size-tap);
		max-inline-size: 60vw;
		padding-inline: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-family: var(--font-mono);
		font-size: max(16px, var(--text-md));
	}
</style>

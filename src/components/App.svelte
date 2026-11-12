<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Text mode (phase-1.md 8): the app shell. Desktop shows the outline beside the editor, tablets
	put the outline in a drawer, phones show one panel at a time under a bottom tab bar (Plan and
	Text). The status strip sits at the bottom of every layout. Nothing here changes the schedule:
	the editor commits text to the workspace and the runner schedules what it sees.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { AppState } from '../lib/state/app.svelte';
	import { LayoutState } from '../lib/state/layout.svelte';
	import { strings } from '../lib/strings';
	import DocsSheet from './DocsSheet.svelte';
	import EditorPanel from './EditorPanel.svelte';
	import OutlinePanel from './OutlinePanel.svelte';
	import PlanSummary from './PlanSummary.svelte';
	import Sheet from './Sheet.svelte';
	import StatusStrip from './StatusStrip.svelte';
	import TabBar from './TabBar.svelte';
	import TopBar from './TopBar.svelte';

	const app = new AppState({ initial: new URLSearchParams(location.search).get('sample') });
	const layout = new LayoutState();
	onDestroy(() => {
		layout.dispose();
		app.dispose();
	});

	const kind = $derived(layout.kind);
	const phone = $derived(kind === 'phone');

	// The drawer only exists on tablets: close it when the window changes layout.
	$effect(() => {
		if (kind !== 'tablet') untrack(() => (app.outlineOpen = false));
	});
</script>

<div class="app" data-layout={kind}>
	<TopBar {app} layout={kind} />
	<main id="main" class="body" tabindex="-1">
		{#if kind === 'desktop'}
			<aside class="outline" aria-label={strings.outline.title}>
				<OutlinePanel {app} />
			</aside>
		{/if}
		{#if phone}
			<div
				id="panel-plan"
				class="panel plan"
				role="tabpanel"
				aria-labelledby="tab-plan"
				hidden={app.phoneTab !== 'plan'}
			>
				<PlanSummary {app} />
				<div class="grow"><OutlinePanel {app} showTitle={false} /></div>
			</div>
		{/if}
		<div
			id="panel-text"
			class="panel text"
			role={phone ? 'tabpanel' : undefined}
			aria-labelledby={phone ? 'tab-text' : undefined}
			hidden={phone && app.phoneTab !== 'text'}
		>
			{#if app.phase === 'failed'}
				<p class="message error" role="alert">{app.loadError}</p>
			{:else if app.workspace}
				{#key app.workspace}
					<EditorPanel {app} ws={app.workspace} layout={kind} />
				{/key}
			{:else}
				<p class="message">{strings.topBar.loading}</p>
			{/if}
		</div>
	</main>
	<StatusStrip {app} compact={phone} />
	{#if phone}<TabBar {app} />{/if}
	{#if kind === 'tablet'}
		<Sheet
			open={app.outlineOpen}
			side="start"
			title={strings.outline.title}
			closeLabel={strings.panels.outlineClose}
			onclose={() => (app.outlineOpen = false)}
		>
			<OutlinePanel {app} showTitle={false} />
		</Sheet>
	{/if}
	<DocsSheet {app} />
</div>

<style>
	.app {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto auto;
		block-size: 100dvh;
		background: var(--color-bg);
	}
	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		min-block-size: 0;
		outline: none;
	}
	.app[data-layout='desktop'] .body {
		grid-template-columns: var(--size-outline) minmax(0, 1fr);
	}
	.outline {
		min-block-size: 0;
		border-inline-end: 1px solid var(--color-border);
		background: var(--color-surface);
	}
	.panel {
		min-block-size: 0;
		min-inline-size: 0;
	}
	.panel[hidden] {
		display: none;
	}
	.plan {
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
	}
	.grow {
		flex: 1 1 0;
		min-block-size: 0;
	}
	.message {
		margin: 0;
		padding: var(--space-6) var(--gutter);
		color: var(--color-text-muted);
	}
	.message.error {
		color: var(--color-diagnostic-error);
	}
</style>

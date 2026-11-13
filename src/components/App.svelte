<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The app shell (phase-1.md 8; phase-2.md 9). Text mode as in Phase 1: desktop shows the outline
	beside the editor, tablets put the outline in a drawer. Split shows the editor and the Gantt
	side by side (stacked on a tablet), Gantt shows the Gantt alone; phones show one panel at a
	time under a bottom tab bar (Plan, Gantt, Text). The view switch is the minimal one of
	src/lib/state/view-mode.ts, which task T14 replaces. The editor stays mounted in every view so
	its state survives a switch. The status strip sits at the bottom of every layout. Nothing here
	changes the schedule: the editor commits text to the workspace and the runner schedules what
	it sees; the Gantt only reads.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { AppState } from '../lib/state/app.svelte';
	import { LayoutState } from '../lib/state/layout.svelte';
	import { effectiveMode, modeFromParam, phoneTabFor, type ViewMode } from '../lib/state/view-mode';
	import { strings } from '../lib/strings';
	import DocsSheet from './DocsSheet.svelte';
	import EditorPanel from './EditorPanel.svelte';
	import Gantt from './gantt/Gantt.svelte';
	import OutlinePanel from './OutlinePanel.svelte';
	import Sheet from './Sheet.svelte';
	import StatusStrip from './StatusStrip.svelte';
	import TabBar from './TabBar.svelte';
	import TopBar from './TopBar.svelte';

	const params = new URLSearchParams(location.search);
	const app = new AppState({ initial: params.get('sample') });
	const linked = modeFromParam(params.get('mode'));
	/** The view the user (or the link) chose; null follows the layout's default. */
	let choice = $state<ViewMode | null>(linked);
	app.phoneTab = phoneTabFor(linked);
	const layout = new LayoutState();
	onDestroy(() => {
		layout.dispose();
		app.dispose();
	});

	const kind = $derived(layout.kind);
	const phone = $derived(kind === 'phone');
	const mode = $derived(effectiveMode(choice, kind));
	const showGantt = $derived(phone ? app.phoneTab === 'gantt' : mode !== 'text');
	const showEditor = $derived(phone ? app.phoneTab === 'text' : mode !== 'gantt');
	/** The Gantt is mounted when first shown and then kept, so zoom and scroll survive a switch. */
	let ganttSeen = $state(false);
	$effect(() => {
		if (showGantt) ganttSeen = true;
	});

	// The drawer only exists on tablets: close it when the window changes layout.
	$effect(() => {
		if (kind !== 'tablet') untrack(() => (app.outlineOpen = false));
	});
</script>

<div class="app" data-layout={kind}>
	<TopBar {app} layout={kind} {mode} onmode={(m) => (choice = m)} />
	<main id="main" class="body" data-mode={mode} tabindex="-1">
		{#if kind === 'desktop' && mode === 'text'}
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
				<div class="grow"><OutlinePanel {app} showTitle={false} /></div>
			</div>
		{/if}
		<div
			id="panel-text"
			class="panel text"
			role={phone ? 'tabpanel' : undefined}
			aria-labelledby={phone ? 'tab-text' : undefined}
			hidden={!showEditor}
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
		{#if ganttSeen}
			<div
				id="panel-gantt"
				class="panel gantt"
				role={phone ? 'tabpanel' : undefined}
				aria-labelledby={phone ? 'tab-gantt' : undefined}
				hidden={!showGantt}
			>
				<Gantt {app} />
			</div>
		{/if}
	</main>
	<StatusStrip {app} compact={phone && app.phoneTab === 'text'} />
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
	.app[data-layout='desktop'] .body[data-mode='text'] {
		grid-template-columns: var(--size-outline) minmax(0, 1fr);
	}
	.app[data-layout='desktop'] .body[data-mode='split'] {
		grid-template-columns: minmax(22rem, 2fr) minmax(0, 3fr);
	}
	.app[data-layout='desktop'] .body[data-mode='split'] .gantt {
		border-inline-start: 1px solid var(--color-border);
	}
	/* A tablet stacks the two, the Gantt above the editor. */
	.app[data-layout='tablet'] .body[data-mode='split'] {
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
	}
	.app[data-layout='tablet'] .body[data-mode='split'] .gantt {
		order: -1;
		border-block-end: 1px solid var(--color-border);
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

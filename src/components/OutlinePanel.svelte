<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!-- The outline: the task tree above the resource tree, and the notice about unsaved changes. -->
<script lang="ts">
	import type { AddMode } from '../lib/gantt/add-task';
	import type { AppState } from '../lib/state/app.svelte';
	import { strings } from '../lib/strings';
	import type { OutlineView } from '../lib/state/outline';
	import AddTaskMenu from './gantt/AddTaskMenu.svelte';
	import OutlineTree from './OutlineTree.svelte';

	interface Props {
		app: AppState;
		/** Heading level offset: the panel sits under an h1 and, on phones, a tab panel. */
		showTitle?: boolean;
		/** The unsaved-changes notice at the foot (a phone shows its compact one on every tab). */
		showNotice?: boolean;
		/** What the two trees keep across an unmount (a phone's Plan tab). */
		views?: { tasks: OutlineView; resources: OutlineView };
		/** The Add task (+) control in the tasks' header: the phone's Plan tab (ADR-0013). */
		add?: { hasSelection: boolean; onadd: (mode: AddMode) => void } | undefined;
	}
	let { app, showTitle = true, showNotice = true, views, add }: Props = $props();
</script>

<div class="panel">
	{#if showTitle}<h2 class="title">{strings.outline.title}</h2>{/if}
	<section class="tasks" aria-labelledby="outline-tasks">
		{#if add}
			<div class="head">
				<h3 id="outline-tasks">{strings.outline.tasks}</h3>
				<AddTaskMenu {...add} align="end" />
			</div>
		{:else}
			<h3 id="outline-tasks">{strings.outline.tasks}</h3>
		{/if}
		<OutlineTree
			label={strings.outline.tasks}
			nodes={app.outline.tasks}
			collapsed={app.collapsed}
			errors={app.errors}
			emptyText={strings.outline.noTasks}
			ontoggle={(k) => app.toggleNode(k)}
			onselect={(n) => app.revealNode(n)}
			view={views?.tasks}
		/>
	</section>
	<section class="resources" aria-labelledby="outline-resources">
		<h3 id="outline-resources">{strings.outline.resources}</h3>
		<OutlineTree
			label={strings.outline.resources}
			nodes={app.outline.resources}
			collapsed={app.collapsed}
			errors={app.errors}
			emptyText={strings.outline.noResources}
			ontoggle={(k) => app.toggleNode(k)}
			onselect={(n) => app.revealNode(n)}
			view={views?.resources}
		/>
	</section>
	{#if showNotice}<p class="notice">{strings.notice}</p>{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		min-block-size: 0;
		block-size: 100%;
	}
	.title {
		margin: 0;
		padding: var(--space-4) var(--space-4) 0;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 400;
	}
	section {
		display: flex;
		flex-direction: column;
		min-block-size: 0;
	}
	.tasks {
		flex: 1 1 0;
	}
	.resources {
		flex: 0 1 38%;
		border-block-start: 1px solid var(--color-border);
	}
	h3 {
		margin: 0;
		padding: var(--space-3) var(--space-4) var(--space-1);
		color: var(--color-text-faint);
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-inline-end: var(--space-3);
		padding-block: var(--space-2);
	}
	.notice {
		margin: 0;
		padding: var(--space-3) var(--space-4);
		border-block-start: 1px solid var(--color-border);
		background: var(--color-surface-sunken);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
</style>

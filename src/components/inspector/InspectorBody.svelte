<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What the inspector shows now (phase-2.md 9.3): the link that is selected, else the task that is
	selected, else a hint to select one. Everything is read from the index and from the schedule the
	Gantt shows (`app.inspector.view`), so the details never disagree with the chart. A task or link
	that has gone from the plan (an undo removed it) says so.
-->
<script lang="ts">
	import { finishScenario } from '../../lib/schedule/finish';
	import { resolveLinks } from '../../lib/gantt/links';
	import { findLink, linksOfTask } from '../../lib/inspector/links';
	import { taskDetails } from '../../lib/inspector/task';
	import { inspectorStrings as S } from '../../lib/strings';
	import { getInspector } from './context';
	import LinkDetails from './LinkDetails.svelte';
	import TaskDetails from './TaskDetails.svelte';

	const { app } = getInspector();

	const view = $derived(app.inspector.view);
	const index = $derived(app.index);
	const result = $derived(view?.result ?? app.run?.lastGood?.result ?? null);
	const project = $derived(result?.project ?? null);
	/** The dependency lines the Gantt draws, for the gaps and where each link is written. */
	const links = $derived(
		index
			? resolveLinks({
					sites: index.dependencies,
					result,
					scenario: result ? finishScenario(result) : null,
					current: view?.current ?? true,
				})
			: [],
	);

	const id = $derived(
		app.selectedTask === null ? null : (app.outline.byKey.get(app.selectedTask)?.id ?? null),
	);
	const details = $derived(
		index && id !== null
			? taskDetails(
					{
						index,
						result,
						analysis: view?.analysis ?? null,
						ws: app.workspace?.snapshot() ?? null,
					},
					id,
				)
			: null,
	);
	const lists = $derived(index && details ? linksOfTask(links, details.id, index, project) : null);
	const sel = $derived(app.inspector.link);
	const one = $derived(index && sel ? findLink(links, sel.pred, sel.succ, index, project) : null);
</script>

{#if sel}
	{#if one}
		<LinkDetails link={one} />
	{:else}
		<p class="hint">{S.dependency.missing}</p>
	{/if}
{:else if app.selectedTask === null}
	<p class="hint">{S.empty}</p>
	<button type="button" class="button" onclick={() => (app.inspector.projectOpen = true)}>
		{S.projectSettings}
	</button>
{:else if details && lists && view}
	{#key details.id}
		<TaskDetails
			d={details}
			model={view.model}
			waitsFor={lists.waitsFor}
			followedBy={lists.followedBy}
		/>
	{/key}
{:else if !index || !view}
	<p class="hint">{S.waiting}</p>
{:else}
	<p class="hint">{S.notFound}</p>
{/if}

<style>
	.hint {
		margin: 0 0 var(--space-3);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.button {
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
	.button:hover {
		background: var(--color-row-hover);
	}
	.button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>

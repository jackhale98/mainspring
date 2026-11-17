<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What the inspector shows now (phase-2.md 9.3): the link that is selected, else the task that is
	selected, else the person that is selected (a lazy chunk: ResourcePanel.svelte), else a hint to select one. Everything is read from the index and from the schedule the
	Gantt shows (`app.inspector.view`), so the details never disagree with the chart. A task or link
	that has gone from the plan (an undo removed it) says so. The task's details mount once per
	selected task (`selection.serial`), not per id, so naming a new task, which can set its id
	(polish item 15), keeps the field that has the focus and never shows the task as gone.
-->
<script lang="ts">
	import { finishScenario } from '../../lib/schedule/finish';
	import { resolveLinks } from '../../lib/gantt/links';
	import { findLink, linksOfTask } from '../../lib/inspector/links';
	import { taskDetails } from '../../lib/inspector/task';
	import { inspectorStrings as S, strings } from '../../lib/strings';
	import LazyMount from '../app/LazyMount.svelte';
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

	// A rename that changes the id (a move, or naming a new task) moves the selection to the new id
	// at once; until the index has it, the task is found by the id it had (`renamedFrom`).
	const id = $derived.by(() => {
		const key = app.selectedTask;
		if (key === null) return null;
		const from = app.selection.renamedFrom;
		const node =
			app.outline.byKey.get(key) ??
			(from === null ? undefined : app.outline.byKey.get(`task:${from}`));
		return node?.id ?? null;
	});
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
	/** The selected person: their details are a chunk of their own (ResourcePanel.svelte). */
	const person = $derived(
		app.selection.current?.kind === 'resource' ? app.selection.current.id : null,
	);
	const sel = $derived(app.inspector.link);
	let attempt = $state(0);
	let failures = $state(0);
	let failed = $state(false);
	function retry(): void {
		if (failures >= 2) {
			if (app.dirty && !globalThis.confirm(strings.update.confirmReload)) return;
			location.reload();
			return;
		}
		failed = false;
		attempt++;
	}
	const one = $derived(index && sel ? findLink(links, sel.pred, sel.succ, index, project) : null);
</script>

{#if sel}
	{#if one}
		<LinkDetails link={one} />
	{:else}
		<p class="hint">{S.dependency.missing}</p>
	{/if}
{:else if person !== null}
	<!-- The person's details are a lazy chunk: a failed fetch says so, and retries (a second failure
	     reloads the page, as the People views do: a browser remembers a failed import). -->
	{#key attempt}
		<LazyMount
			when
			load={() => import('./ResourcePanel.svelte')}
			props={{ id: person }}
			onfail={() => {
				failures++;
				failed = true;
			}}
		/>
	{/key}
	{#if failed}
		<div class="failed" role="alert" data-testid="person-failed">
			<p class="hint">{S.personLoadFailed}</p>
			<button type="button" class="button" onclick={retry}>
				{failures >= 2 ? strings.people.reload : strings.people.retry}
			</button>
		</div>
	{/if}
{:else if app.selectedTask === null}
	<p class="hint">{app.inspector.peopleView ? S.personEmpty : S.empty}</p>
	<button type="button" class="button" onclick={() => (app.inspector.projectOpen = true)}>
		{S.projectSettings}
	</button>
{:else if details && lists && view}
	<!-- One mount per selected task: a rename that changes its id keeps the fields (and the focus). -->
	{#key app.selection.serial}
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
	.failed {
		display: grid;
		justify-items: start;
	}
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

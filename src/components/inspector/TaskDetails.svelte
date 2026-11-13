<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The task inspector's body (phase-2.md 9.3): name and id, size, what the scheduler made of the
	task, people, dates, options, flags and links. It only draws what lib/inspector/task.ts read
	and sends what the person changes through the edit dispatcher; it never changes the schedule.
	A task declared with a macro is shown read-only with the way to its text.
-->
<script lang="ts">
	import type { GanttModel } from '../../lib/gantt/model';
	import type { LinkFact } from '../../lib/inspector/links';
	import type { TaskDetails } from '../../lib/inspector/task';
	import { inspectorStrings as S } from '../../lib/strings';
	import CommitInput from './CommitInput.svelte';
	import { getInspector } from './context';
	import DatesSection from './DatesSection.svelte';
	import DependencyList from './DependencyList.svelte';
	import Field from './Field.svelte';
	import FlagsField from './FlagsField.svelte';
	import OptionsSection from './OptionsSection.svelte';
	import PeopleSection from './PeopleSection.svelte';
	import ScheduleBlock from './ScheduleBlock.svelte';
	import SizeSection from './SizeSection.svelte';

	interface Props {
		d: TaskDetails;
		model: GanttModel;
		waitsFor: readonly LinkFact[];
		followedBy: readonly LinkFact[];
	}
	let { d, model, waitsFor, followedBy }: Props = $props();
	const { app, actions, showInText } = getInspector();

	const rename = async (name: string): Promise<boolean> => {
		const text = name.trim();
		if (text === '') return false;
		return (await actions.action({ type: 'rename', task: d.id, name: text })).status === 'applied';
	};
</script>

<div class="task">
	{#if d.declaration}
		<p class="notice">{S.declarationTextOnly}</p>
	{/if}
	<Field label={S.field.name}>
		{#snippet children({ id, disabled, describedby })}
			<CommitInput
				{id}
				value={d.name}
				disabled={disabled || d.declaration !== null}
				{describedby}
				oncommit={rename}
			/>
		{/snippet}
	</Field>
	<p class="id"><span class="k">{S.field.id}</span> <code>{d.id}</code></p>

	{#if d.declaration === null}
		<section aria-labelledby="{d.id}-size">
			<h3 id="{d.id}-size">{S.section.size}</h3>
			<SizeSection {d} />
		</section>
	{/if}

	<section aria-labelledby="{d.id}-schedule">
		<h3 id="{d.id}-schedule">{S.section.schedule}</h3>
		<ScheduleBlock {d} {model} />
	</section>

	{#if d.declaration === null}
		<section aria-labelledby="{d.id}-people">
			<h3 id="{d.id}-people">{S.section.people}</h3>
			<PeopleSection {d} />
		</section>
		<section aria-labelledby="{d.id}-dates">
			<h3 id="{d.id}-dates">{S.section.dates}</h3>
			<DatesSection {d} />
		</section>
		<section aria-labelledby="{d.id}-options">
			<h3 id="{d.id}-options">{S.section.options}</h3>
			<OptionsSection {d} />
		</section>
		<section aria-labelledby="{d.id}-flags">
			<h3 id="{d.id}-flags">{S.field.flags}</h3>
			<FlagsField {d} />
		</section>
		<section aria-labelledby="{d.id}-links">
			<h3 id="{d.id}-links">{S.section.links}</h3>
			<DependencyList {waitsFor} {followedBy} />
		</section>
	{/if}

	<div class="source">
		<button type="button" class="button" onclick={() => (app.inspector.source = d.id)}>
			{S.showSource}
		</button>
		<button type="button" class="button" onclick={() => showInText(d.sym.decl.header)}>
			{S.showInText}
		</button>
	</div>
</div>

<style>
	.task {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-block-start: var(--space-3);
		border-block-start: 1px solid var(--color-border);
	}
	h3 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.id {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		margin: 0;
		font-size: var(--text-sm);
	}
	.id .k {
		color: var(--color-text-muted);
		font-size: var(--text-label);
		font-weight: 600;
	}
	code {
		font-family: var(--font-mono);
		overflow-wrap: anywhere;
	}
	.notice {
		margin: 0;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
		font-size: var(--text-sm);
	}
	.source {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding-block-start: var(--space-3);
		border-block-start: 1px solid var(--color-border);
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
		outline-offset: 1px;
	}
</style>

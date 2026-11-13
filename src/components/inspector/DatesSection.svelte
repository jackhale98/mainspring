<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The four date constraints of a task (phase-2.md 9.3): `start`, `end`, `minstart` and `maxend`,
	as TaskJuggler writes them (`2026-03-02`, `2026-03-02-09:00`) in the project's time zone. An
	empty field has no such statement; emptying a field removes it. `start` and `end` fix the task,
	which is a constraint, so the field says so; the first one added also gets a toast warning, once
	per browser (ADR-0008 #2). The edit API checks the value (inside the project frame, aligned to
	the timing resolution) and refuses a bad one with its reason.
-->
<script lang="ts">
	import { dateEdit, type DateAttr } from '../../lib/inspector/edit';
	import type { TaskDetails } from '../../lib/inspector/task';
	import { inspectorStrings as S } from '../../lib/strings';
	import CommitInput from './CommitInput.svelte';
	import { getInspector } from './context';
	import Field from './Field.svelte';

	let { d }: { d: TaskDetails } = $props();
	const { actions, showInText } = getInspector();

	const FIELDS: ReadonlyArray<{ attr: DateAttr; hint: string }> = [
		{ attr: 'start', hint: S.constraintStart },
		{ attr: 'end', hint: S.constraintEnd },
		{ attr: 'minstart', hint: S.constraintBound },
		{ attr: 'maxend', hint: S.constraintBound },
	];

	const commit = (attr: DateAttr) => async (text: string) =>
		(await actions.edit(dateEdit(d, attr, text))).status === 'applied';
</script>

<div class="dates">
	{#each FIELDS as f (f.attr)}
		{@const state = d[f.attr]}
		<Field
			label={S.field[f.attr]}
			{state}
			hint={state.kind === 'own' || state.kind === 'inherited' ? f.hint : S.dateHint}
			onshow={showInText}
		>
			{#snippet children({ id, disabled, describedby })}
				<CommitInput
					{id}
					value={state.kind === 'own' || state.kind === 'inherited' ? state.text : ''}
					{disabled}
					{describedby}
					mono
					placeholder="2026-03-02"
					oncommit={commit(f.attr)}
				/>
			{/snippet}
		</Field>
	{/each}
</div>

<style>
	.dates {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		align-items: start;
	}
	@media (max-width: 22rem) {
		.dates {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>

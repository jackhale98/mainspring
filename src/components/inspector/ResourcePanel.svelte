<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What the inspector shows for a selected person (phase-3.md 9.6): their details, read from the
	index and the schedule the People views show, or a sentence when they are no longer in the plan
	(an undo removed them). It is its own lazy chunk (InspectorBody mounts it when a person is
	selected), so the person details and the working-hours editor stay out of a Gantt-first load.
	The details mount once per selected person (`selection.serial`), so a rename keeps the field that
	has the focus.
-->
<script lang="ts">
	import { personDetails } from '../../lib/resources/person';
	import { resourceStrings as R } from '../../lib/strings-resources';
	import { getInspector } from './context';
	import ResourceDetails from './ResourceDetails.svelte';

	let { id }: { id: string } = $props();
	const { app, showCalendar } = getInspector();

	const result = $derived(app.run?.lastGood?.result ?? null);
	const details = $derived(app.index ? personDetails(app.index, result, id) : null);
</script>

{#if details}
	{#key app.selection.serial}
		<ResourceDetails d={details} onaddleave={() => showCalendar?.(id)} />
	{/key}
{:else if !app.index}
	<p class="hint">{R.details.empty}</p>
{:else}
	<p class="hint">{R.details.notFound}</p>
{/if}

<style>
	.hint {
		margin: 0 0 var(--space-3);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>

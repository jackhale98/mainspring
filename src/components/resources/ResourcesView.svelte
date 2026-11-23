<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Resources view (phase-3.md 9.1, 9.2): the resource table on the left and the lanes on the
	right, with the Gantt's divider between them (SplitDivider, the same separator: arrow keys, a
	pointer drag, a 44 px handle on a touch screen). The divider's place is the table's share of the
	width, kept per plan (lib/resources/prefs.ts). A narrow view (a tablet, Split mode beside the
	editor) shows the table as the name and hours.

	Three ways to use it, one chunk:
	- the desktop and tablet's Resources view: the table, the divider and the lanes;
	- the phone's Lanes segment (`phone`): the lanes alone, as before;
	- the phone's Team segment (`team`): the table alone, filling the People tab. A first tap on a
	  person selects them and a second opens their details in the bottom sheet, as a task's.

	The lanes are their own chunk, fetched when they are shown (the Team segment never fetches them),
	and keep their own toolbar in the People bar (`setBar`) and their own name column: the table is
	where people are added, renamed, regrouped and deleted, and its rows do not scroll with the
	lanes. Selecting a person in the table selects them for the whole app, so the details open in the
	right panel (or the bottom sheet) and the text shows their declaration.
-->
<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import {
		browserStorage,
		readRatio,
		TABLE_RATIO_LIMITS,
		writeRatio,
	} from '../../lib/resources/prefs';
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import { resourceStrings as R } from '../../lib/strings-resources';
	import SplitDivider from '../app/SplitDivider.svelte';
	import { LazyModule } from '../people/lazy.svelte';
	import ViewFailed from '../people/ViewFailed.svelte';
	import ResourceTable from './ResourceTable.svelte';

	interface Props {
		app: AppState;
		/** A phone: the lanes alone (Lanes segment), or the table alone with `team` (Team segment). */
		phone?: boolean;
		/** The phone's Team segment: the table alone. */
		team?: boolean;
		/** This is the view on screen (it stays mounted while another People view shows). */
		active?: boolean;
		/** Puts the lanes' toolbar in the People bar (a desktop and a tablet). */
		setBar?: (bar: Snippet | null) => void;
	}
	let {
		app,
		phone = false,
		team = false,
		active = true,
		setBar = () => undefined,
	}: Props = $props();

	const lanes = new LazyModule(() => import('./Lanes.svelte'));
	$effect(() => {
		if (!team) lanes.load();
	});

	const storage = browserStorage();
	let container: HTMLDivElement | undefined = $state();
	let ratio = $state(0.4);
	// Read when a plan opens; written under the plan's key at the time (a sample's copy has its own).
	$effect(() => {
		void app.openSerial;
		untrack(() => (ratio = readRatio(storage, app.planKey)));
	});
</script>

<div
	class="resources"
	class:phone
	class:team
	bind:this={container}
	hidden={!active}
	data-testid="resources-view"
>
	{#if team}
		<div class="whole" data-testid="team-view"><ResourceTable {app} phone /></div>
	{:else}
		{#if !phone}
			<div class="table" style:flex-basis="{ratio * 100}%">
				<ResourceTable {app} phone={false} />
			</div>
			<SplitDivider
				axis="col"
				value={ratio}
				{container}
				limits={TABLE_RATIO_LIMITS}
				label={R.view.divider}
				firstName={R.view.table}
				onchange={(v) => (ratio = v)}
				oncommit={() => writeRatio(storage, app.planKey, ratio)}
			/>
		{/if}
		<div class="lanes">
			{#if lanes.module}
				{@const Lanes = lanes.module.default}
				<Lanes {app} {phone} {active} {setBar} />
			{:else if lanes.failed}
				<ViewFailed lazy={lanes} reload={() => app.reloadPage()} testid="lanes-failed" />
			{:else}
				<p class="message" role="status">{strings.people.loading}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.resources {
		display: flex;
		block-size: 100%;
		min-block-size: 0;
		min-inline-size: 0;
		background: var(--color-gantt-surface);
	}
	/* Not the view on screen (the Lanes segment's copy, kept mounted, while the Team segment shows):
	   it takes no room in the People area, or the table after it would start part way down. */
	.resources[hidden] {
		display: none;
	}
	.table {
		flex: 0 0 auto;
		min-inline-size: 0;
		overflow: hidden;
	}
	.lanes,
	.whole {
		flex: 1 1 0;
		min-inline-size: 0;
		min-block-size: 0;
	}
	.message {
		margin: 0;
		padding: var(--space-6) var(--gutter);
		color: var(--color-text-muted);
		text-align: center;
	}
</style>

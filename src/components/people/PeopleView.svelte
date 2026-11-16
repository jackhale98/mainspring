<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The People views' content, the entry of the lazy chunk (phase-3.md 8.3): everything the People
	views and the insight modules import hangs off this component, so a Gantt-first load never
	fetches it (PeopleSlot.svelte imports it when a People view first opens, and keeps it).

	T13 builds the shell only. For each content (`workload`, `resources`, `calendar`, `team`) it
	shows the "No people" state when the plan declares no resource (lib/people/shell.ts), else a
	short placeholder that T14 (heatmap), T15 (lanes), T16 (calendar) and T17 (resource table)
	replace. After Add person the keyboard focus goes to the content, where the button was.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { peopleState, type PeopleContent } from '../../lib/people/shell';
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import NoPeople from './NoPeople.svelte';

	interface Props {
		app: AppState;
		content: PeopleContent;
	}
	let { app, content }: Props = $props();

	const S = strings.people;
	const shown = $derived(
		peopleState(content, {
			indexed: app.index !== null,
			resources: app.outline.resources.length,
		}),
	);
	let coming: HTMLElement | undefined = $state();
	let focusContent = $state(false);

	// The button that was pressed leaves with the state: the focus goes to what replaces it, once
	// the index has the new person (a keyboard user is not dropped on the page).
	$effect(() => {
		if (!focusContent || shown !== 'content' || !coming) return;
		focusContent = false;
		void tick().then(() => coming?.focus());
	});
</script>

<div class="host" data-testid="people-host" data-content={content} data-state={shown}>
	{#if shown === 'loading'}
		<p class="message" role="status">{strings.topBar.loading}</p>
	{:else if shown === 'none'}
		<NoPeople {app} ondone={() => (focusContent = true)} />
	{:else}
		<p class="message" data-testid="people-coming" tabindex="-1" bind:this={coming}>
			{S.coming[content]}
		</p>
	{/if}
</div>

<style>
	.host {
		display: flex;
		flex-direction: column;
		justify-content: center;
		block-size: 100%;
		min-block-size: 0;
		overflow: auto;
		background: var(--color-gantt-surface);
	}
	.message {
		margin: 0;
		padding: var(--space-6) var(--gutter);
		color: var(--color-text-muted);
		text-align: center;
	}
	.message:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: -3px;
	}
</style>

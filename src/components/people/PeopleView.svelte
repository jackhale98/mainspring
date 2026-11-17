<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The People views' content, the entry of the lazy chunk (phase-3.md 8.3): everything the People
	views and the insight modules import hangs off this component, so a Gantt-first load never
	fetches it (PeopleSlot.svelte imports it when a People view first opens, and keeps it).

	For each content (`workload`, `resources`, `calendar`, `team`) it shows the "No people" state
	when the plan declares no resource (lib/people/empty.ts), else the content: the workload heatmap
	(T14, components/workload), which stays mounted once seen so that its scroll, zoom and selection
	survive a switch to another view, the calendar (T16, components/calendar), which needs no people
	(Everyone's holidays) and keeps its month and mode in a state made here, and for the rest a short
	placeholder that T15 (lanes) and T17 (resource table) replace. After Add person the keyboard focus goes to the
	content, where the button was.
-->
<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { peopleState } from '../../lib/people/empty';
	import type { PeopleContent } from '../../lib/people/shell';
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import Calendar from '../calendar/Calendar.svelte';
	import { CalendarState } from '../calendar/calendar-state.svelte';
	import Workload from '../workload/Workload.svelte';
	import NoPeople from './NoPeople.svelte';

	interface Props {
		app: AppState;
		content: PeopleContent;
		/** The phone's People tab: the heatmap's toolbar is a row of the view, else the People bar's. */
		phone: boolean;
		setBar: (bar: Snippet | null) => void;
		showGantt: () => void;
	}
	let { app, content, phone, setBar, showGantt }: Props = $props();

	const S = strings.people;
	const shown = $derived(
		peopleState(content, {
			indexed: app.index !== null,
			resources: app.outline.resources.length,
		}),
	);
	let coming: HTMLElement | undefined = $state();
	let host: HTMLDivElement | undefined = $state();
	let focusContent = $state(false);
	/** The calendar's month, mode and focus, kept while another view shows. */
	const calendar = new CalendarState();
	/** The heatmap is mounted when first shown and then kept (its scroll and zoom survive a switch). */
	let heatmapSeen = $state(false);
	$effect(() => {
		if (content === 'workload' && shown === 'content') heatmapSeen = true;
	});

	// The button that was pressed leaves with the state: the focus goes to what replaces it, once
	// the index has the new person (a keyboard user is not dropped on the page). The heatmap's is
	// its first cell, which exists once the schedule has been read into rows.
	$effect(() => {
		if (!focusContent || shown !== 'content') return;
		if (content === 'workload') {
			let frames = 0;
			const look = (): void => {
				const cell = host?.querySelector<HTMLElement>('[data-testid="heat-cell"][tabindex="0"]');
				if (cell) cell.focus({ preventScroll: true });
				else if (frames++ < 120) requestAnimationFrame(look);
				// No schedule to read yet (a plan with a person and no task): the view itself.
				else host?.querySelector<HTMLElement>('[data-testid="workload"]')?.focus();
			};
			focusContent = false;
			look();
			return;
		}
		if (!coming) return;
		focusContent = false;
		void tick().then(() => coming?.focus());
	});
</script>

<div
	class="host"
	class:flush={(heatmapSeen && content === 'workload') || content === 'calendar'}
	bind:this={host}
	data-testid="people-host"
	data-content={content}
	data-state={shown}
>
	{#if heatmapSeen && shown === 'content'}
		<Workload {app} {phone} active={content === 'workload'} {setBar} {showGantt} />
	{/if}
	{#if shown === 'loading'}
		<p class="message" role="status">{strings.topBar.loading}</p>
	{:else if shown === 'none'}
		<NoPeople {app} ondone={() => (focusContent = true)} />
	{:else if content === 'calendar'}
		<Calendar {app} {phone} state={calendar} {showGantt} />
	{:else if content !== 'workload'}
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
	/* The heatmap fills the area itself (it scrolls inside), so the host does not centre or scroll. */
	.host.flush {
		justify-content: stretch;
		overflow: hidden;
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
